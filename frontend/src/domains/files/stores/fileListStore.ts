/**
 * File List Store
 *
 * Zustand store for managing file list state.
 * Handles file CRUD operations, pagination, and loading states.
 * Pure state management - no API calls (those live in hooks).
 *
 * @module domains/files/stores/fileListStore
 */

import { create } from 'zustand';
import type { ParsedFile } from '@bc-agent/shared';
import { useFileProcessingStore } from './fileProcessingStore';

/**
 * File list state
 */
export interface FileListState {
  /** Array of files in current view */
  files: ParsedFile[];
  /** Total count of files (for pagination) */
  totalFiles: number;
  /** Whether more files can be loaded */
  hasMore: boolean;
  /** Current pagination offset */
  currentOffset: number;
  /** Items per page */
  currentLimit: number;
  /** Loading indicator */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
}

/**
 * File list actions
 */
export interface FileListActions {
  /** Set files from API response, resets offset */
  setFiles: (files: ParsedFile[], total: number, hasMore: boolean) => void;
  /** Add a single file to the beginning of the list */
  addFile: (file: ParsedFile) => void;
  /** Update a file by ID with partial changes */
  updateFile: (id: string, updates: Partial<ParsedFile>) => void;
  /** Remove files by IDs */
  deleteFiles: (ids: string[]) => void;
  /** Append files for pagination (load more) */
  appendFiles: (files: ParsedFile[], hasMore: boolean) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error message */
  setError: (error: string | null) => void;
  /** Reset all state to initial */
  reset: () => void;
}

/**
 * Initial state
 */
const initialState: FileListState = {
  files: [],
  totalFiles: 0,
  hasMore: false,
  currentOffset: 0,
  currentLimit: 50,
  isLoading: false,
  error: null,
};

/**
 * File List store
 *
 * Manages file list state independently of API operations.
 * API calls should be handled by hooks that use this store.
 *
 * @example
 * ```tsx
 * function FileList() {
 *   const { files, isLoading, error } = useFileListStore();
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error} />;
 *
 *   return files.map(file => <FileItem key={file.id} file={file} />);
 * }
 * ```
 */
export const useFileListStore = create<FileListState & FileListActions>()(
  (set) => ({
    ...initialState,

    setFiles: (files, total, hasMore) => {
      set({
        files,
        totalFiles: total,
        hasMore,
        currentOffset: files.length,
      });
    },

    addFile: (file) => {
      // Check if WebSocket events arrived before HTTP response and updated fileProcessingStore
      // If so, merge the latest status from fileProcessingStore into the new file
      // Note: Normalize ID to lowercase for case-insensitive matching (SQL Server returns uppercase,
      // WebSocket events use lowercase)
      const normalizedId = file.id.toUpperCase();
      const processingStatus = useFileProcessingStore.getState().processingFiles.get(normalizedId);
      const fileWithLatestStatus = processingStatus
        ? { ...file, readinessState: processingStatus.readinessState }
        : file;

      console.log('[fileListStore] addFile called:', file.id, {
        originalState: file.readinessState,
        processingStoreState: processingStatus?.readinessState,
        finalState: fileWithLatestStatus.readinessState,
      });

      set((state) => ({
        files: [fileWithLatestStatus, ...state.files],
        totalFiles: state.totalFiles + 1,
      }));
    },

    updateFile: (id, updates) => {
      // Normalize ID to lowercase for case-insensitive matching
      const normalizedId = id.toUpperCase();
      console.log('[fileListStore] updateFile called:', normalizedId, updates);
      set((state) => {
        const fileExists = state.files.some((file) => file.id.toUpperCase() === normalizedId);
        console.log('[fileListStore] File exists in store:', fileExists, 'Total files:', state.files.length);
        if (!fileExists) {
          console.warn('[fileListStore] File not found in store, update will have no effect:', normalizedId);
        }
        return {
          files: state.files.map((file) =>
            file.id.toUpperCase() === normalizedId ? { ...file, ...updates } : file
          ),
        };
      });
    },

    deleteFiles: (ids) => {
      if (ids.length === 0) return;

      // Normalize IDs to lowercase for case-insensitive matching
      const normalizedIds = ids.map((id) => id.toUpperCase());

      set((state) => {
        const remainingFiles = state.files.filter(
          (file) => !normalizedIds.includes(file.id.toUpperCase())
        );
        const deletedCount = state.files.length - remainingFiles.length;

        return {
          files: remainingFiles,
          totalFiles: Math.max(0, state.totalFiles - deletedCount),
        };
      });
    },

    appendFiles: (files, hasMore) => {
      set((state) => ({
        files: [...state.files, ...files],
        hasMore,
        currentOffset: state.currentOffset + files.length,
      }));
    },

    setLoading: (isLoading) => {
      set({ isLoading });
    },

    setError: (error) => {
      set({ error });
    },

    reset: () => {
      set(initialState);
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetFileListStore(): void {
  useFileListStore.setState(initialState);
}
