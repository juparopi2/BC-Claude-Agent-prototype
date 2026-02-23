/**
 * Files Domain - Stores
 *
 * Re-exports all file-related Zustand stores.
 *
 * @module domains/files/stores
 */

export {
  useFilePreviewStore,
  resetFilePreviewStore,
  type FilePreviewState,
  type FilePreviewActions,
} from './filePreviewStore';

export {
  useSortFilterStore,
  resetSortFilterStore,
  type SortFilterState,
  type SortFilterActions,
} from './sortFilterStore';

export {
  useSelectionStore,
  resetSelectionStore,
  type SelectionState,
  type SelectionActions,
} from './selectionStore';

export {
  useFileListStore,
  resetFileListStore,
  type FileListState,
  type FileListActions,
} from './fileListStore';

export {
  useFolderTreeStore,
  resetFolderTreeStore,
  type FolderTreeState,
  type FolderTreeActions,
} from './folderTreeStore';

export {
  useFileProcessingStore,
  resetFileProcessingStore,
  selectFileProcessingStatus,
  type FileProcessingState,
  type FileProcessingActions,
  type FileProcessingStatus,
} from './fileProcessingStore';

export {
  useUploadLimitStore,
  resetUploadLimitStore,
  type UploadLimitState,
} from './uploadLimitStore';

export {
  useUnsupportedFilesStore,
  resetUnsupportedFilesStore,
  type UnsupportedFilesState,
  type UnsupportedFilesResolution,
} from './unsupportedFilesStore';

export {
  useFolderDuplicateStore,
  resetFolderDuplicateStore,
  type FolderDuplicateStoreState,
  type FolderDuplicateStoreActions,
  type FolderDuplicateAction,
  type FolderDuplicateResolution,
} from './folderDuplicateStore';

// Stores (Batch Upload Pipeline)
export {
  useBatchUploadStore,
  resetBatchUploadStore,
  type BatchUploadState,
  type BatchUploadActions,
  type BatchFileState,
  type ActiveBatch,
} from './uploadBatchStore';

export {
  useDuplicateStore,
  resetDuplicateStore,
  type DuplicateStoreState,
  type DuplicateStoreActions,
  type DuplicateAction,
} from './duplicateStore';
