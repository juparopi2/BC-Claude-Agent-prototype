/**
 * File Preview Store
 *
 * Zustand store for managing file preview modal state.
 * Controls which file is being previewed and modal visibility.
 *
 * @module domains/files/stores/filePreviewStore
 */

import { create } from 'zustand';

/**
 * File preview state
 */
export interface FilePreviewState {
  /** Whether the preview modal is open */
  isOpen: boolean;
  /** ID of the file being previewed */
  fileId: string | null;
  /** Name of the file being previewed */
  fileName: string | null;
  /** MIME type of the file being previewed */
  mimeType: string | null;
}

/**
 * File preview actions
 */
export interface FilePreviewActions {
  /** Open the preview modal with a file */
  openPreview: (fileId: string, fileName: string, mimeType: string) => void;
  /** Close the preview modal */
  closePreview: () => void;
}

/**
 * Initial state
 */
const initialState: FilePreviewState = {
  isOpen: false,
  fileId: null,
  fileName: null,
  mimeType: null,
};

/**
 * File preview store
 */
export const useFilePreviewStore = create<FilePreviewState & FilePreviewActions>()(
  (set) => ({
    // Initial state
    ...initialState,

    // Actions
    openPreview: (fileId: string, fileName: string, mimeType: string) => {
      set({
        isOpen: true,
        fileId,
        fileName,
        mimeType,
      });
    },

    closePreview: () => {
      set({
        isOpen: false,
        fileId: null,
        fileName: null,
        mimeType: null,
      });
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetFilePreviewStore(): void {
  useFilePreviewStore.setState(initialState);
}
