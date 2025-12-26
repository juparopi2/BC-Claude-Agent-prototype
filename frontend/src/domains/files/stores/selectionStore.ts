/**
 * Selection Store
 *
 * Zustand store for managing file selection state.
 * Supports single select, multi-select (Ctrl+click), and range select (Shift+click).
 *
 * @module domains/files/stores/selectionStore
 */

import { create } from 'zustand';

/**
 * Selection state
 */
export interface SelectionState {
  /** Set of selected file IDs */
  selectedFileIds: Set<string>;
  /** ID of the last selected file (for range selection) */
  lastSelectedId: string | null;
}

/**
 * Selection actions
 */
export interface SelectionActions {
  /** Select a file. If multi is true, adds to selection; otherwise replaces. */
  selectFile: (fileId: string, multi?: boolean) => void;
  /** Select a range of files from last selected to the given file */
  selectRange: (fileId: string, allFileIds: string[]) => void;
  /** Select all files */
  selectAll: (allFileIds: string[]) => void;
  /** Clear all selection */
  clearSelection: () => void;
  /** Check if any files are selected */
  hasSelection: () => boolean;
  /** Get count of selected files */
  getSelectedCount: () => number;
}

/**
 * Initial state
 */
const initialState: SelectionState = {
  selectedFileIds: new Set(),
  lastSelectedId: null,
};

/**
 * Selection store
 *
 * Manages file selection state independently of file list.
 * Selection methods receive file IDs as parameters to stay decoupled.
 *
 * @example
 * ```tsx
 * function FileList({ files }) {
 *   const { selectedFileIds, selectFile, selectRange } = useSelectionStore();
 *   const allFileIds = files.map(f => f.id);
 *
 *   return files.map(file => (
 *     <FileItem
 *       key={file.id}
 *       file={file}
 *       selected={selectedFileIds.has(file.id)}
 *       onClick={(e) => {
 *         if (e.shiftKey) selectRange(file.id, allFileIds);
 *         else selectFile(file.id, e.ctrlKey || e.metaKey);
 *       }}
 *     />
 *   ));
 * }
 * ```
 */
export const useSelectionStore = create<SelectionState & SelectionActions>()(
  (set, get) => ({
    ...initialState,

    selectFile: (fileId, multi = false) => {
      set((state) => {
        const newSelection = new Set(multi ? state.selectedFileIds : []);

        if (multi && newSelection.has(fileId)) {
          // Toggle off if already selected in multi mode
          newSelection.delete(fileId);
        } else {
          // Add to selection
          newSelection.add(fileId);
        }

        return {
          selectedFileIds: newSelection,
          lastSelectedId: fileId,
        };
      });
    },

    selectRange: (fileId, allFileIds) => {
      set((state) => {
        const { lastSelectedId, selectedFileIds } = state;

        // Find indices
        const fileIndex = allFileIds.indexOf(fileId);
        if (fileIndex === -1) {
          // File not in list, don't change selection
          return state;
        }

        // If no previous selection, just select this file
        if (!lastSelectedId || selectedFileIds.size === 0) {
          return {
            selectedFileIds: new Set([fileId]),
            lastSelectedId: fileId,
          };
        }

        // Find last selected index
        const lastIndex = allFileIds.indexOf(lastSelectedId);
        if (lastIndex === -1) {
          // Last selected not in list, just select this file
          return {
            selectedFileIds: new Set([fileId]),
            lastSelectedId: fileId,
          };
        }

        // Calculate range
        const [min, max] = lastIndex < fileIndex
          ? [lastIndex, fileIndex]
          : [fileIndex, lastIndex];

        // Select all files in range
        const rangeIds = allFileIds.slice(min, max + 1);
        return {
          selectedFileIds: new Set(rangeIds),
          lastSelectedId: fileId,
        };
      });
    },

    selectAll: (allFileIds) => {
      set({
        selectedFileIds: new Set(allFileIds),
        lastSelectedId: allFileIds.length > 0 ? allFileIds[allFileIds.length - 1] : null,
      });
    },

    clearSelection: () => {
      set({
        selectedFileIds: new Set(),
        lastSelectedId: null,
      });
    },

    hasSelection: () => {
      return get().selectedFileIds.size > 0;
    },

    getSelectedCount: () => {
      return get().selectedFileIds.size;
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetSelectionStore(): void {
  useSelectionStore.setState({
    selectedFileIds: new Set(),
    lastSelectedId: null,
  });
}
