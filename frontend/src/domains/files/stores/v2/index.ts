/**
 * V2 Stores - Barrel Exports
 *
 * @module domains/files/stores/v2
 */

export {
  useBatchUploadStoreV2,
  resetBatchUploadStoreV2,
  type BatchUploadState,
  type BatchUploadActions,
  type BatchFileState,
  type ActiveBatch,
} from './batchUploadStoreV2';

export {
  useDuplicateStoreV2,
  resetDuplicateStoreV2,
  type DuplicateStoreV2State,
  type DuplicateStoreV2Actions,
  type DuplicateActionV2,
} from './duplicateStoreV2';
