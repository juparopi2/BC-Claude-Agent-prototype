/**
 * Upload Store
 *
 * Zustand store for managing file upload queue state.
 * Tracks upload progress, status, and completed files.
 * Pure state management - actual upload logic lives in hooks.
 *
 * @module domains/files/stores/uploadStore
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { ParsedFile } from '@bc-agent/shared';

/**
 * Upload item status
 */
export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'error';

/**
 * Upload item in queue
 */
export interface UploadItem {
  /** Unique ID for this upload */
  id: string;
  /** File object to upload */
  file: File;
  /** Upload status */
  status: UploadStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Error message if failed */
  error?: string;
  /** Result from server after completion */
  resultFile?: ParsedFile;
}

/**
 * Upload state
 */
export interface UploadState {
  /** Queue of upload items */
  queue: UploadItem[];
  /** Whether any upload is in progress */
  isUploading: boolean;
  /** Overall progress across all items (0-100) */
  overallProgress: number;
}

/**
 * Upload actions
 */
export interface UploadActions {
  /** Add files to upload queue with pending status */
  addToQueue: (files: File[]) => void;
  /** Mark an item as uploading */
  startUpload: (itemId: string) => void;
  /** Update progress for a specific item */
  updateProgress: (itemId: string, progress: number) => void;
  /** Mark upload as completed with server file */
  completeUpload: (itemId: string, resultFile: ParsedFile) => void;
  /** Mark upload as failed with error */
  failUpload: (itemId: string, error: string) => void;
  /** Remove a single item from queue */
  removeFromQueue: (itemId: string) => void;
  /** Clear entire queue */
  clearQueue: () => void;
  /** Reset to initial state */
  reset: () => void;
  /** Get count of pending items */
  getPendingCount: () => number;
  /** Get count of completed items */
  getCompletedCount: () => number;
  /** Get count of failed items */
  getFailedCount: () => number;
}

/**
 * Initial state
 */
const initialState: UploadState = {
  queue: [],
  isUploading: false,
  overallProgress: 0,
};

/**
 * Calculate overall progress from queue items
 */
function calculateOverallProgress(queue: UploadItem[]): number {
  if (queue.length === 0) return 0;
  const total = queue.reduce((sum, item) => sum + item.progress, 0);
  return Math.round(total / queue.length);
}

/**
 * Check if any item is currently uploading
 */
function hasUploadingItems(queue: UploadItem[]): boolean {
  return queue.some((item) => item.status === 'uploading');
}

/**
 * Upload store
 *
 * Manages file upload queue state independently of actual upload operations.
 * Upload logic should be handled by hooks that use this store.
 *
 * @example
 * ```tsx
 * function UploadProgress() {
 *   const { queue, overallProgress, isUploading } = useUploadStore();
 *
 *   if (!isUploading) return null;
 *
 *   return (
 *     <div>
 *       <ProgressBar value={overallProgress} />
 *       {queue.map(item => (
 *         <UploadItem key={item.id} item={item} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export const useUploadStore = create<UploadState & UploadActions>()(
  (set, get) => ({
    ...initialState,

    addToQueue: (files) => {
      const newItems: UploadItem[] = files.map((file) => ({
        id: nanoid(),
        file,
        status: 'pending',
        progress: 0,
      }));

      set((state) => ({
        queue: [...state.queue, ...newItems],
      }));
    },

    startUpload: (itemId) => {
      set((state) => {
        const itemExists = state.queue.some((item) => item.id === itemId);
        if (!itemExists) return state;

        const newQueue = state.queue.map((item) =>
          item.id === itemId ? { ...item, status: 'uploading' as UploadStatus } : item
        );

        return {
          queue: newQueue,
          isUploading: true,
        };
      });
    },

    updateProgress: (itemId, progress) => {
      set((state) => {
        const newQueue = state.queue.map((item) =>
          item.id === itemId ? { ...item, progress } : item
        );

        return {
          queue: newQueue,
          overallProgress: calculateOverallProgress(newQueue),
        };
      });
    },

    completeUpload: (itemId, resultFile) => {
      set((state) => {
        const newQueue = state.queue.map((item) =>
          item.id === itemId
            ? { ...item, status: 'completed' as UploadStatus, progress: 100, resultFile }
            : item
        );

        return {
          queue: newQueue,
          isUploading: hasUploadingItems(newQueue),
          overallProgress: calculateOverallProgress(newQueue),
        };
      });
    },

    failUpload: (itemId, error) => {
      set((state) => {
        const newQueue = state.queue.map((item) =>
          item.id === itemId
            ? { ...item, status: 'error' as UploadStatus, error }
            : item
        );

        return {
          queue: newQueue,
          isUploading: hasUploadingItems(newQueue),
        };
      });
    },

    removeFromQueue: (itemId) => {
      set((state) => {
        const newQueue = state.queue.filter((item) => item.id !== itemId);

        return {
          queue: newQueue,
          overallProgress: calculateOverallProgress(newQueue),
          isUploading: hasUploadingItems(newQueue),
        };
      });
    },

    clearQueue: () => {
      set({
        queue: [],
        isUploading: false,
        overallProgress: 0,
      });
    },

    reset: () => {
      set(initialState);
    },

    getPendingCount: () => {
      return get().queue.filter((item) => item.status === 'pending').length;
    },

    getCompletedCount: () => {
      return get().queue.filter((item) => item.status === 'completed').length;
    },

    getFailedCount: () => {
      return get().queue.filter((item) => item.status === 'error').length;
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetUploadStore(): void {
  useUploadStore.setState(initialState);
}
