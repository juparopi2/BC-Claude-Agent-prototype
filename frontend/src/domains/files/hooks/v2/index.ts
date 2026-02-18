/**
 * V2 Hooks - Barrel Exports
 *
 * @module domains/files/hooks/v2
 */

export {
  useBatchUploadV2,
  type UseBatchUploadV2Return,
} from './useBatchUploadV2';

export {
  useBlobUploadV2,
  type BlobUploadFile,
  type BlobUploadResult,
} from './useBlobUploadV2';

export {
  useFileConfirmV2,
} from './useFileConfirmV2';

export {
  useDuplicateResolutionV2,
} from './useDuplicateResolutionV2';

export {
  useUploadProgressV2,
  type UploadProgressV2,
  type UploadCountsV2,
  type UploadPhaseV2,
} from './useUploadProgressV2';
