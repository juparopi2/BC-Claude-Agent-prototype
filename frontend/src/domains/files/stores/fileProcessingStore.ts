/**
 * File Processing Store
 *
 * Zustand store for tracking file processing status in real-time.
 * Manages state for files that are uploading, processing, ready, or failed.
 *
 * This store is updated by WebSocket events from the backend and provides
 * the source of truth for UI indicators showing file processing state.
 *
 * @module domains/files/stores/fileProcessingStore
 */

import { create } from 'zustand';
import type { FileReadinessState } from '@bc-agent/shared';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Processing status for a single file
 */
export interface FileProcessingStatus {
  /** Current readiness state */
  readinessState: FileReadinessState;
  /** Processing progress (0-100) */
  progress?: number;
  /** Current retry attempt number (1-based) */
  attemptNumber?: number;
  /** Maximum retry attempts configured */
  maxAttempts?: number;
  /** Error message if failed */
  error?: string;
  /** Whether user can manually retry via API */
  canRetryManually?: boolean;
}

// ============================================================================
// STATE INTERFACE
// ============================================================================

/**
 * File processing state
 */
export interface FileProcessingState {
  /** Map of fileId to processing status */
  processingFiles: Map<string, FileProcessingStatus>;
}

// ============================================================================
// ACTIONS INTERFACE
// ============================================================================

/**
 * File processing actions
 */
export interface FileProcessingActions {
  /** Set or update processing status for a file (partial update supported) */
  setProcessingStatus: (fileId: string, status: Partial<FileProcessingStatus>) => void;
  /** Update progress for a file with optional attempt info */
  updateProgress: (
    fileId: string,
    progress: number,
    attemptNumber?: number,
    maxAttempts?: number
  ) => void;
  /** Mark file as completed (ready state, progress 100%) */
  markCompleted: (fileId: string) => void;
  /** Mark file as failed with error and retry flag */
  markFailed: (fileId: string, error: string, canRetryManually: boolean) => void;
  /** Remove processing status for a file */
  removeProcessingStatus: (fileId: string) => void;
  /** Reset all state */
  reset: () => void;
}

// ============================================================================
// COMBINED TYPE
// ============================================================================

export type FileProcessingStore = FileProcessingState & FileProcessingActions;

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: FileProcessingState = {
  processingFiles: new Map(),
};

// ============================================================================
// STORE
// ============================================================================

/**
 * File Processing Store
 *
 * Tracks real-time processing status for files.
 * Updated by WebSocket events from backend FileEventEmitter.
 *
 * @example
 * ```tsx
 * function FileStatusBadge({ fileId }: { fileId: string }) {
 *   const status = useFileProcessingStore(
 *     state => selectFileProcessingStatus(state, fileId)
 *   );
 *
 *   if (!status) return null;
 *
 *   return (
 *     <Badge variant={status.readinessState}>
 *       {status.progress}%
 *     </Badge>
 *   );
 * }
 * ```
 */
export const useFileProcessingStore = create<FileProcessingStore>()((set, get) => ({
  ...initialState,

  setProcessingStatus: (fileId, status) => {
    set((state) => {
      const newMap = new Map(state.processingFiles);
      const existing = newMap.get(fileId);

      if (existing) {
        // Merge with existing status
        newMap.set(fileId, { ...existing, ...status });
      } else {
        // Create new entry with required field
        newMap.set(fileId, {
          readinessState: status.readinessState ?? 'processing',
          ...status,
        });
      }

      return { processingFiles: newMap };
    });
  },

  updateProgress: (fileId, progress, attemptNumber, maxAttempts) => {
    const existing = get().processingFiles.get(fileId);

    // Only update if file exists in the map
    if (!existing) {
      return;
    }

    set((state) => {
      const newMap = new Map(state.processingFiles);
      const current = newMap.get(fileId);

      if (current) {
        newMap.set(fileId, {
          ...current,
          progress,
          ...(attemptNumber !== undefined && { attemptNumber }),
          ...(maxAttempts !== undefined && { maxAttempts }),
        });
      }

      return { processingFiles: newMap };
    });
  },

  markCompleted: (fileId) => {
    set((state) => {
      const newMap = new Map(state.processingFiles);
      const existing = newMap.get(fileId);

      if (existing) {
        newMap.set(fileId, {
          ...existing,
          readinessState: 'ready',
          progress: 100,
          error: undefined,
        });
      } else {
        newMap.set(fileId, {
          readinessState: 'ready',
          progress: 100,
        });
      }

      return { processingFiles: newMap };
    });
  },

  markFailed: (fileId, error, canRetryManually) => {
    set((state) => {
      const newMap = new Map(state.processingFiles);
      const existing = newMap.get(fileId);

      if (existing) {
        newMap.set(fileId, {
          ...existing,
          readinessState: 'failed',
          error,
          canRetryManually,
        });
      } else {
        newMap.set(fileId, {
          readinessState: 'failed',
          error,
          canRetryManually,
        });
      }

      return { processingFiles: newMap };
    });
  },

  removeProcessingStatus: (fileId) => {
    set((state) => {
      const newMap = new Map(state.processingFiles);
      newMap.delete(fileId);
      return { processingFiles: newMap };
    });
  },

  reset: () => {
    set({ processingFiles: new Map() });
  },
}));

// ============================================================================
// SELECTORS
// ============================================================================

/**
 * Select processing status for a specific file
 *
 * @param state - Store state
 * @param fileId - File ID to get status for
 * @returns Processing status or undefined if not tracked
 */
export function selectFileProcessingStatus(
  state: FileProcessingState,
  fileId: string
): FileProcessingStatus | undefined {
  return state.processingFiles.get(fileId);
}

// ============================================================================
// RESET FUNCTION
// ============================================================================

/**
 * Reset store to initial state (for testing)
 */
export function resetFileProcessingStore(): void {
  useFileProcessingStore.setState(initialState);
}
