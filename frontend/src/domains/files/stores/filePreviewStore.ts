/**
 * File Preview Store
 *
 * Zustand store for managing file preview modal state.
 * Controls which file is being previewed and modal visibility.
 * Supports both single file preview and citation carousel navigation.
 *
 * @module domains/files/stores/filePreviewStore
 */

import { create } from 'zustand';
import type { CitationInfo } from '@/lib/types/citation.types';

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
  /** Current index in the citations array */
  currentIndex: number;
  /** Whether navigation mode is active (multiple citations) */
  isNavigationMode: boolean;
}

/**
 * File preview actions
 */
export interface FilePreviewActions {
  /** Open the preview modal with a single file */
  openPreview: (fileId: string, fileName: string, mimeType: string) => void;
  /** Open the preview modal with citation navigation */
  openCitationPreview: (citations: CitationInfo[], startIndex: number) => void;
  /** Navigate to a specific index in citations */
  navigateTo: (index: number) => void;
  /** Navigate to next citation */
  navigateNext: () => void;
  /** Navigate to previous citation */
  navigatePrev: () => void;
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
  citations: [],
  currentIndex: 0,
  isNavigationMode: false,
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
      });
    },

    navigateTo: (index: number) => {
      const { citations } = get();
      if (index < 0 || index >= citations.length) {
        return;
      }

      const current = citations[index];
      set({
        currentIndex: index,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
      });
    },

    navigateNext: () => {
      const { currentIndex, citations } = get();
      const nextIndex = currentIndex + 1;

      if (nextIndex >= citations.length) {
        return;
      }

      const current = citations[nextIndex];
      set({
        currentIndex: nextIndex,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
      });
    },

    navigatePrev: () => {
      const { currentIndex, citations } = get();
      const prevIndex = currentIndex - 1;

      if (prevIndex < 0) {
        return;
      }

      const current = citations[prevIndex];
      set({
        currentIndex: prevIndex,
        fileId: current.fileId,
        fileName: current.fileName,
        mimeType: current.mimeType,
      });
    },

    closePreview: () => {
      set({
        isOpen: false,
        fileId: null,
        fileName: null,
        mimeType: null,
        citations: [],
        currentIndex: 0,
        isNavigationMode: false,
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
