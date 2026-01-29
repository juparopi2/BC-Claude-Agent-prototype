/**
 * Folder Duplicate Store
 *
 * Manages state for duplicate folder detection during upload.
 * Tracks conflicts, user resolutions, and modal visibility.
 *
 * @module domains/files/stores/folderDuplicateStore
 */

import { create } from 'zustand';

/**
 * Actions available for resolving folder duplicates
 */
export type FolderDuplicateAction = 'skip' | 'rename' | 'cancel';

/**
 * Single duplicate folder conflict detected during upload
 */
export interface FolderDuplicateConflict {
  /** Client-generated temp ID for correlation */
  tempId: string;
  /** Original folder name */
  originalName: string;
  /** Suggested name with suffix (e.g., "Documents (1)") */
  suggestedName: string;
  /** Parent folder ID (null for root level) */
  parentFolderId: string | null;
  /** ID of the existing folder with same name */
  existingFolderId: string;
  /** Number of files in this folder */
  fileCount: number;
}

/**
 * User's resolution for a folder duplicate conflict
 */
export interface FolderDuplicateResolution {
  /** Temp ID for correlation */
  tempId: string;
  /** User action: skip or rename */
  action: Exclude<FolderDuplicateAction, 'cancel'>;
  /** Resolved name to use (original if skip, suggested if rename) */
  resolvedName: string;
}

/**
 * Folder duplicate store state
 */
interface FolderDuplicateState {
  /** List of detected conflicts */
  conflicts: FolderDuplicateConflict[];
  /** Current conflict index being shown */
  currentIndex: number;
  /** User resolutions for each conflict */
  resolutions: FolderDuplicateResolution[];
  /** Whether the conflict modal is open */
  isModalOpen: boolean;
  /** Whether the upload was cancelled */
  isCancelled: boolean;
  /** Session ID this duplicate check is for */
  sessionId: string | null;
}

/**
 * Folder duplicate store actions
 */
interface FolderDuplicateActions {
  /** Set detected conflicts and open modal */
  setConflicts: (sessionId: string, conflicts: FolderDuplicateConflict[]) => void;
  /** Resolve a single conflict */
  resolveConflict: (tempId: string, action: FolderDuplicateAction) => void;
  /** Apply action to all remaining conflicts */
  resolveAllRemaining: (action: Exclude<FolderDuplicateAction, 'cancel'>) => void;
  /** Open the modal */
  openModal: () => void;
  /** Close the modal */
  closeModal: () => void;
  /** Reset all state */
  reset: () => void;
  /** Get resolution for a tempId */
  getResolution: (tempId: string) => FolderDuplicateResolution | undefined;
  /** Check if all conflicts are resolved */
  isAllResolved: () => boolean;
  /** Get all resolutions */
  getResolutions: () => FolderDuplicateResolution[];
  /** Get current conflict */
  getCurrentConflict: () => FolderDuplicateConflict | undefined;
}

const initialState: FolderDuplicateState = {
  conflicts: [],
  currentIndex: 0,
  resolutions: [],
  isModalOpen: false,
  isCancelled: false,
  sessionId: null,
};

/**
 * Zustand store for duplicate folder management
 *
 * @example
 * ```tsx
 * function UploadComponent() {
 *   const { conflicts, isModalOpen, resolveConflict } = useFolderDuplicateStore();
 *
 *   // Show modal when conflicts detected
 *   useEffect(() => {
 *     if (conflicts.length > 0) {
 *       // Modal opens automatically via setConflicts
 *     }
 *   }, [conflicts]);
 * }
 * ```
 */
export const useFolderDuplicateStore = create<FolderDuplicateState & FolderDuplicateActions>()(
  (set, get) => ({
    ...initialState,

    setConflicts: (sessionId, conflicts) => {
      set({
        sessionId,
        conflicts,
        currentIndex: 0,
        resolutions: [],
        isCancelled: false,
      });
      if (conflicts.length > 0) {
        set({ isModalOpen: true });
      }
    },

    resolveConflict: (tempId, action) => {
      if (action === 'cancel') {
        // Cancel means abort entire upload
        set({
          isModalOpen: false,
          conflicts: [],
          resolutions: [],
          isCancelled: true,
        });
        return;
      }

      const { conflicts, currentIndex, resolutions } = get();
      const conflict = conflicts.find((c) => c.tempId === tempId);

      if (conflict) {
        const resolution: FolderDuplicateResolution = {
          tempId,
          action,
          resolvedName: action === 'rename' ? conflict.suggestedName : conflict.originalName,
        };

        const newResolutions = [...resolutions, resolution];
        const newIndex = currentIndex + 1;

        if (newIndex >= conflicts.length) {
          // All conflicts resolved
          set({
            resolutions: newResolutions,
            currentIndex: newIndex,
            isModalOpen: false,
          });
        } else {
          set({ resolutions: newResolutions, currentIndex: newIndex });
        }
      }
    },

    resolveAllRemaining: (action) => {
      const { conflicts, currentIndex, resolutions } = get();
      const newResolutions = [...resolutions];

      for (let i = currentIndex; i < conflicts.length; i++) {
        const conflict = conflicts[i];
        if (conflict) {
          newResolutions.push({
            tempId: conflict.tempId,
            action,
            resolvedName: action === 'rename' ? conflict.suggestedName : conflict.originalName,
          });
        }
      }

      set({
        resolutions: newResolutions,
        currentIndex: conflicts.length,
        isModalOpen: false,
      });
    },

    openModal: () => set({ isModalOpen: true }),
    closeModal: () => set({ isModalOpen: false }),

    reset: () => set(initialState),

    getResolution: (tempId) => {
      return get().resolutions.find((r) => r.tempId === tempId);
    },

    isAllResolved: () => {
      const { conflicts, resolutions, isCancelled } = get();
      if (isCancelled) return true;
      if (conflicts.length === 0) return true;
      return resolutions.length >= conflicts.length;
    },

    getResolutions: () => {
      return get().resolutions;
    },

    getCurrentConflict: () => {
      const { conflicts, currentIndex } = get();
      return conflicts[currentIndex];
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetFolderDuplicateStore(): void {
  useFolderDuplicateStore.setState(initialState);
}

/**
 * Wait for folder conflict resolution
 *
 * Returns a promise that resolves when all conflicts are resolved
 * or the upload is cancelled.
 *
 * @returns Promise with resolutions array, or null if cancelled
 */
export function waitForFolderResolution(): Promise<FolderDuplicateResolution[] | null> {
  return new Promise((resolve) => {
    const unsubscribe = useFolderDuplicateStore.subscribe((state) => {
      if (state.isCancelled) {
        unsubscribe();
        resolve(null);
        return;
      }

      if (state.conflicts.length > 0 && state.resolutions.length >= state.conflicts.length) {
        unsubscribe();
        resolve(state.resolutions);
        return;
      }

      // Check if modal was closed without resolving (edge case)
      if (!state.isModalOpen && state.conflicts.length > 0 && state.resolutions.length === 0) {
        unsubscribe();
        resolve(null);
        return;
      }
    });
  });
}
