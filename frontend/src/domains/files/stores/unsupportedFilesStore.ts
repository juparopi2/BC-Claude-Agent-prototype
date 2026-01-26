/**
 * Unsupported Files Store
 *
 * Zustand store for managing unsupported file types detected during folder upload.
 * Groups files by extension and allows skip/cancel actions.
 *
 * @module domains/files/stores/unsupportedFilesStore
 */

import { create } from 'zustand';
import type { FileEntry, InvalidFilesByExtension, UnsupportedFileAction } from '../types/folderUpload.types';
import { groupInvalidFilesByExtension } from '../utils/folderReader';

/**
 * Resolution for unsupported files
 */
export interface UnsupportedFilesResolution {
  /** Whether to proceed with valid files only */
  proceed: boolean;

  /** Files to skip (by path) */
  skippedPaths: Set<string>;
}

/**
 * Unsupported files store state interface
 */
export interface UnsupportedFilesState {
  /** Whether the modal is open */
  isModalOpen: boolean;

  /** All invalid files */
  invalidFiles: FileEntry[];

  /** Files grouped by extension */
  groupedByExtension: InvalidFilesByExtension[];

  /** Current extension being reviewed (index in groupedByExtension) */
  currentExtensionIndex: number;

  /** Paths of files marked to skip */
  skippedPaths: Set<string>;

  /** Whether the upload was cancelled */
  isCancelled: boolean;

  /** Promise resolver for waiting on resolution */
  resolvePromise: ((resolution: UnsupportedFilesResolution) => void) | null;

  /** Actions */
  /** Open modal with invalid files and return a promise that resolves when user decides */
  openModal: (invalidFiles: FileEntry[]) => Promise<UnsupportedFilesResolution>;

  /** Skip the current file being shown */
  skipCurrent: () => void;

  /** Skip all files with the current extension */
  skipAllOfExtension: () => void;

  /** Skip all invalid files and proceed */
  skipAllInvalid: () => void;

  /** Cancel the entire upload */
  cancelUpload: () => void;

  /** Close modal (internal use) */
  closeModal: () => void;

  /** Reset the store */
  reset: () => void;
}

/**
 * Initial state
 */
const initialState = {
  isModalOpen: false,
  invalidFiles: [] as FileEntry[],
  groupedByExtension: [] as InvalidFilesByExtension[],
  currentExtensionIndex: 0,
  skippedPaths: new Set<string>(),
  isCancelled: false,
  resolvePromise: null as ((resolution: UnsupportedFilesResolution) => void) | null,
};

/**
 * Unsupported files store for managing invalid file type detection
 *
 * @example
 * ```tsx
 * function FileUploadZone() {
 *   const { openModal } = useUnsupportedFilesStore();
 *
 *   const handleFolderDrop = async (structure: FolderStructure) => {
 *     if (structure.invalidFiles.length > 0) {
 *       const resolution = await openModal(structure.invalidFiles);
 *       if (!resolution.proceed) {
 *         return; // User cancelled
 *       }
 *       // Filter out skipped files and proceed
 *       const filesToUpload = structure.validFiles;
 *     }
 *   };
 * }
 * ```
 */
export const useUnsupportedFilesStore = create<UnsupportedFilesState>((set, get) => ({
  ...initialState,

  openModal: (invalidFiles: FileEntry[]) => {
    const grouped = groupInvalidFilesByExtension(invalidFiles);

    return new Promise<UnsupportedFilesResolution>((resolve) => {
      set({
        isModalOpen: true,
        invalidFiles,
        groupedByExtension: grouped,
        currentExtensionIndex: 0,
        skippedPaths: new Set(),
        isCancelled: false,
        resolvePromise: resolve,
      });
    });
  },

  skipCurrent: () => {
    const state = get();
    const currentGroup = state.groupedByExtension[state.currentExtensionIndex];

    if (!currentGroup || currentGroup.files.length === 0) return;

    // Skip first file in current group
    const fileToSkip = currentGroup.files[0];
    const newSkippedPaths = new Set(state.skippedPaths);
    newSkippedPaths.add(fileToSkip.path);

    // Remove file from current group
    const newGrouped = [...state.groupedByExtension];
    newGrouped[state.currentExtensionIndex] = {
      ...currentGroup,
      files: currentGroup.files.slice(1),
      count: currentGroup.count - 1,
    };

    // If current group is empty, move to next or finish
    let newIndex = state.currentExtensionIndex;
    if (newGrouped[newIndex].count === 0) {
      // Find next non-empty group
      const nextIndex = newGrouped.findIndex((g, i) => i > newIndex && g.count > 0);
      if (nextIndex === -1) {
        // All done, resolve with proceed
        state.resolvePromise?.({ proceed: true, skippedPaths: newSkippedPaths });
        set({ ...initialState });
        return;
      }
      newIndex = nextIndex;
    }

    // Filter out empty groups
    const filteredGroups = newGrouped.filter((g) => g.count > 0);
    const adjustedIndex = filteredGroups.findIndex(
      (g) => g.extension === newGrouped[newIndex]?.extension
    );

    set({
      skippedPaths: newSkippedPaths,
      groupedByExtension: filteredGroups,
      currentExtensionIndex: Math.max(0, adjustedIndex),
    });
  },

  skipAllOfExtension: () => {
    const state = get();
    const currentGroup = state.groupedByExtension[state.currentExtensionIndex];

    if (!currentGroup) return;

    // Skip all files in current extension group
    const newSkippedPaths = new Set(state.skippedPaths);
    for (const file of currentGroup.files) {
      newSkippedPaths.add(file.path);
    }

    // Remove current extension group
    const newGrouped = state.groupedByExtension.filter(
      (_, i) => i !== state.currentExtensionIndex
    );

    // If no more groups, resolve
    if (newGrouped.length === 0) {
      state.resolvePromise?.({ proceed: true, skippedPaths: newSkippedPaths });
      set({ ...initialState });
      return;
    }

    // Adjust index
    const newIndex = Math.min(state.currentExtensionIndex, newGrouped.length - 1);

    set({
      skippedPaths: newSkippedPaths,
      groupedByExtension: newGrouped,
      currentExtensionIndex: newIndex,
    });
  },

  skipAllInvalid: () => {
    const state = get();

    // Skip all invalid files
    const newSkippedPaths = new Set(state.skippedPaths);
    for (const file of state.invalidFiles) {
      newSkippedPaths.add(file.path);
    }

    // Resolve with proceed
    state.resolvePromise?.({ proceed: true, skippedPaths: newSkippedPaths });
    set({ ...initialState });
  },

  cancelUpload: () => {
    const state = get();

    // Resolve with cancel
    state.resolvePromise?.({ proceed: false, skippedPaths: new Set() });
    set({ ...initialState, isCancelled: true });
  },

  closeModal: () => {
    const state = get();

    // If modal is closed without explicit action, treat as cancel
    if (state.resolvePromise) {
      state.resolvePromise({ proceed: false, skippedPaths: new Set() });
    }

    set({ ...initialState });
  },

  reset: () => {
    set({ ...initialState });
  },
}));

/**
 * Reset store to initial state (for testing)
 */
export function resetUnsupportedFilesStore(): void {
  useUnsupportedFilesStore.getState().reset();
}
