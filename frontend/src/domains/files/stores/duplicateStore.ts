/**
 * Duplicate Store
 *
 * Manages state for duplicate file detection during upload.
 * Tracks conflicts, user resolutions, and modal visibility.
 *
 * @module domains/files/stores/duplicateStore
 */

import { create } from 'zustand';
import type { ParsedFile, DuplicateAction } from '@bc-agent/shared';

/**
 * Single duplicate conflict detected during upload
 */
export interface DuplicateConflict {
  /** Client-generated temp ID for correlation */
  tempId: string;
  /** New file being uploaded */
  newFile: File;
  /** Existing file in storage with same content hash */
  existingFile: ParsedFile;
  /** Content hash (SHA-256) */
  hash: string;
}

/**
 * User's resolution for a duplicate conflict
 */
export interface DuplicateResolution {
  /** Temp ID for correlation */
  tempId: string;
  /** User action: replace or skip */
  action: Exclude<DuplicateAction, 'cancel'>;
  /** Existing file ID to delete (if replacing) */
  existingFileId?: string;
}

/**
 * Duplicate store state
 */
interface DuplicateState {
  /** List of detected conflicts */
  conflicts: DuplicateConflict[];
  /** Current conflict index being shown */
  currentIndex: number;
  /** User resolutions for each conflict */
  resolutions: DuplicateResolution[];
  /** Whether the conflict modal is open */
  isModalOpen: boolean;
  /** Whether the upload was cancelled */
  isCancelled: boolean;
}

/**
 * Duplicate store actions
 */
interface DuplicateActions {
  /** Set detected conflicts and open modal */
  setConflicts: (conflicts: DuplicateConflict[]) => void;
  /** Resolve a single conflict */
  resolveConflict: (tempId: string, action: DuplicateAction) => void;
  /** Apply action to all remaining conflicts */
  resolveAllRemaining: (action: Exclude<DuplicateAction, 'cancel'>) => void;
  /** Open the modal */
  openModal: () => void;
  /** Close the modal */
  closeModal: () => void;
  /** Reset all state */
  reset: () => void;
  /** Get resolution for a tempId */
  getResolution: (tempId: string) => DuplicateResolution | undefined;
  /** Check if all conflicts are resolved */
  isAllResolved: () => boolean;
}

const initialState: DuplicateState = {
  conflicts: [],
  currentIndex: 0,
  resolutions: [],
  isModalOpen: false,
  isCancelled: false,
};

/**
 * Zustand store for duplicate file management
 *
 * @example
 * ```tsx
 * function UploadComponent() {
 *   const { conflicts, isModalOpen, resolveConflict } = useDuplicateStore();
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
export const useDuplicateStore = create<DuplicateState & DuplicateActions>()(
  (set, get) => ({
    ...initialState,

    setConflicts: (conflicts) => {
      set({
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
        const resolution: DuplicateResolution = {
          tempId,
          action,
          existingFileId: action === 'replace' ? conflict.existingFile.id : undefined,
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
            existingFileId: action === 'replace' ? conflict.existingFile.id : undefined,
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
  })
);
