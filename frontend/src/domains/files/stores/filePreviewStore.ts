/**
 * File Preview Store
 *
 * Zustand store for managing file preview modal state.
 * Controls which file is being previewed and modal visibility.
 * Supports both citation carousel navigation and folder file navigation.
 *
 * @module domains/files/stores/filePreviewStore
 */

import { create } from 'zustand';
import type { CitationInfo } from '@/lib/types/citation.types';

/**
 * Item representing a previewable file in folder navigation mode
 */
export interface FolderPreviewItem {
  fileId: string;
  fileName: string;
  mimeType: string;
}

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
  /** Array of citations for carousel navigation */
  citations: CitationInfo[];
  /** Current index in the navigation array */
  currentIndex: number;
  /** Whether navigation mode is active (multiple items) */
  isNavigationMode: boolean;
  /** Array of folder files for folder navigation mode */
  folderFiles: FolderPreviewItem[];
  /** Whether folder navigation mode is active */
  isFolderNavigationMode: boolean;
}

/**
 * File preview actions
 */
export interface FilePreviewActions {
  /** Open the preview modal with a single file */
  openPreview: (fileId: string, fileName: string, mimeType: string) => void;
  /** Open the preview modal with citation navigation */
  openCitationPreview: (citations: CitationInfo[], startIndex: number) => void;
  /** Open the preview modal with folder file navigation */
  openFolderPreview: (files: FolderPreviewItem[], startIndex: number) => void;
  /** Navigate to a specific index */
  navigateTo: (index: number) => void;
  /** Navigate to next item */
  navigateNext: () => void;
  /** Navigate to previous item */
  navigatePrev: () => void;
  /** Close the preview modal */
  closePreview: () => void;
}

/**
 * Get the current navigation items based on mode
 */
function getNavigationItems(state: FilePreviewState): Array<{ fileId: string | null; fileName: string; mimeType: string }> {
  if (state.isFolderNavigationMode) return state.folderFiles;
  return state.citations;
}

/**
 * Initial state
 */
const initialState: FilePreviewState = {
  isOpen: false,
  fileId: null,
  fileName: null,
  mimeType: null,
  citations: [],
  currentIndex: 0,
  isNavigationMode: false,
  folderFiles: [],
  isFolderNavigationMode: false,
};

/**
 * File preview store
 */
export const useFilePreviewStore = create<FilePreviewState & FilePreviewActions>()(
  (set, get) => ({
    // Initial state
    ...initialState,

    // Actions
    openPreview: (fileId: string, fileName: string, mimeType: string) => {
      set({
        isOpen: true,
        fileId,
        fileName,
        mimeType,
        citations: [],
        currentIndex: 0,
        isNavigationMode: false,
        folderFiles: [],
        isFolderNavigationMode: false,
      });
    },

    openCitationPreview: (citations: CitationInfo[], startIndex: number) => {
      // Filter out deleted files and files without IDs
      const validCitations = citations.filter((c) => !c.isDeleted && c.fileId);

      if (validCitations.length === 0) {
        return;
      }

      const safeIndex = Math.min(Math.max(0, startIndex), validCitations.length - 1);
      const current = validCitations[safeIndex];

      set({
        isOpen: true,
        citations: validCitations,
        currentIndex: safeIndex,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
        isNavigationMode: validCitations.length > 1,
        folderFiles: [],
        isFolderNavigationMode: false,
      });
    },

    openFolderPreview: (files: FolderPreviewItem[], startIndex: number) => {
      if (files.length === 0) {
        return;
      }

      const safeIndex = Math.min(Math.max(0, startIndex), files.length - 1);
      const current = files[safeIndex];

      set({
        isOpen: true,
        folderFiles: files,
        currentIndex: safeIndex,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
        isNavigationMode: files.length > 1,
        isFolderNavigationMode: true,
        citations: [],
      });
    },

    navigateTo: (index: number) => {
      const state = get();
      const items = getNavigationItems(state);
      if (index < 0 || index >= items.length) {
        return;
      }

      const current = items[index];
      set({
        currentIndex: index,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
      });
    },

    navigateNext: () => {
      const state = get();
      const items = getNavigationItems(state);
      const nextIndex = state.currentIndex + 1;

      if (nextIndex >= items.length) {
        return;
      }

      const current = items[nextIndex];
      set({
        currentIndex: nextIndex,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
      });
    },

    navigatePrev: () => {
      const state = get();
      const items = getNavigationItems(state);
      const prevIndex = state.currentIndex - 1;

      if (prevIndex < 0) {
        return;
      }

      const current = items[prevIndex];
      set({
        currentIndex: prevIndex,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
      });
    },

    closePreview: () => {
      set(initialState);
    },
  })
);

/**
 * Reset store to initial state (for testing)
 */
export function resetFilePreviewStore(): void {
  useFilePreviewStore.setState(initialState);
}
