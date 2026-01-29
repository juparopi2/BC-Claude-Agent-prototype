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
  useUploadStore,
  resetUploadStore,
  type UploadState,
  type UploadActions,
  type UploadItem,
  type UploadStatus,
} from './uploadStore';

export {
  useFolderTreeStore,
  resetFolderTreeStore,
  type FolderTreeState,
  type FolderTreeActions,
} from './folderTreeStore';

export {
  useDuplicateStore,
  type DuplicateConflict,
  type DuplicateResolution,
} from './duplicateStore';

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
  useUploadSessionStore,
  resetUploadSessionStore,
  type UploadSessionState,
  type UploadSessionActions,
} from './uploadSessionStore';

export {
  useMultiUploadSessionStore,
  resetMultiUploadSessionStore,
  type MultiUploadSessionState,
  type MultiUploadSessionActions,
} from './multiUploadSessionStore';

export {
  useFolderDuplicateStore,
  resetFolderDuplicateStore,
  waitForFolderResolution,
  type FolderDuplicateConflict,
  type FolderDuplicateResolution,
  type FolderDuplicateAction,
} from './folderDuplicateStore';
