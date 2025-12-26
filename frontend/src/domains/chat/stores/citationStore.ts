/**
 * Citation Store
 *
 * Manages the mapping between file names and file IDs for citations.
 * Used to resolve citation references in messages.
 *
 * @module domains/chat/stores/citationStore
 */

import { create } from 'zustand';

/**
 * Map of file name to file ID
 */
export type CitationFileMap = Map<string, string>;

/**
 * Citation state
 */
export interface CitationState {
  /** Map of file name -> file ID */
  citationFileMap: CitationFileMap;
}

/**
 * Citation actions
 */
export interface CitationActions {
  /** Set citation mapping for a file */
  setCitationFile: (fileName: string, fileId: string) => void;
  /** Get file ID for a file name */
  getCitationFile: (fileName: string) => string | undefined;
  /** Set entire citation map (replaces existing) */
  setCitationMap: (map: CitationFileMap) => void;
  /** Clear all citations */
  clearCitations: () => void;
  /** Reset to initial state */
  reset: () => void;
}

/**
 * Combined citation store type
 */
export type CitationStore = CitationState & CitationActions;

/**
 * Initial state
 */
const initialState: CitationState = {
  citationFileMap: new Map(),
};

/**
 * Citation store for managing file name to ID mappings.
 *
 * @example
 * ```typescript
 * // Get file ID for a citation
 * const fileId = useCitationStore(s => s.getCitationFile('report.pdf'));
 *
 * // Update citations from complete event
 * const { setCitationMap } = useCitationStore();
 * setCitationMap(new Map([['report.pdf', 'file-123']]));
 * ```
 */
export const useCitationStore = create<CitationStore>((set, get) => ({
  ...initialState,

  setCitationFile: (fileName, fileId) => {
    set((state) => {
      const newMap = new Map(state.citationFileMap);
      newMap.set(fileName, fileId);
      return { citationFileMap: newMap };
    });
  },

  getCitationFile: (fileName) => {
    return get().citationFileMap.get(fileName);
  },

  setCitationMap: (map) => {
    set({ citationFileMap: new Map(map) });
  },

  clearCitations: () => {
    set({ citationFileMap: new Map() });
  },

  reset: () => {
    set(initialState);
  },
}));

/**
 * Get the citation store instance (for non-React contexts)
 */
export function getCitationStore() {
  return useCitationStore;
}

/**
 * Reset citation store to initial state (for testing)
 */
export function resetCitationStore() {
  useCitationStore.setState(initialState);
}
