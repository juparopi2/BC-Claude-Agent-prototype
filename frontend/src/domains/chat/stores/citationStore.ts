/**
 * Citation Store
 *
 * Manages the mapping between file names and file IDs for citations.
 * Extended with rich metadata for enhanced UI (badges, carousel, source icons).
 *
 * @module domains/chat/stores/citationStore
 */

import { create } from 'zustand';
import type { CitedFile } from '@bc-agent/shared';
import type { CitationInfo, CitationInfoMap } from '@/lib/types/citation.types';

/**
 * Map of file name to file ID (legacy)
 */
export type CitationFileMap = Map<string, string>;

/**
 * Citation state
 */
export interface CitationState {
  /** Map of file name -> file ID (legacy, for backward compatibility) */
  citationFileMap: CitationFileMap;
  /** Map of file name -> CitationInfo (rich metadata) */
  citationInfoMap: CitationInfoMap;
  /** Map of message ID -> CitationInfo[] (per-message citations) */
  messageCitations: Map<string, CitationInfo[]>;
}

/**
 * Message with optional citations from API response
 */
export interface MessageWithCitations {
  id: string;
  citedFiles?: CitedFile[];
}

/**
 * Citation actions
 */
export interface CitationActions {
  /** Set citation mapping for a file (legacy) */
  setCitationFile: (fileName: string, fileId: string) => void;
  /** Get file ID for a file name (legacy) */
  getCitationFile: (fileName: string) => string | undefined;
  /** Set entire citation map (replaces existing, legacy) */
  setCitationMap: (map: CitationFileMap) => void;
  /** Set cited files from CompleteEvent with full metadata */
  setCitedFiles: (citedFiles: CitedFile[], messageId?: string) => void;
  /** Get rich citation info for a file name */
  getCitationInfo: (fileName: string) => CitationInfo | undefined;
  /** Get citations for a specific message */
  getMessageCitations: (messageId: string) => CitationInfo[];
  /** Hydrate citations from API response (page load) */
  hydrateFromMessages: (messages: MessageWithCitations[]) => void;
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
  citationInfoMap: new Map(),
  messageCitations: new Map(),
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

  /**
   * Set cited files from CompleteEvent with full metadata.
   * Updates both legacy citationFileMap and rich citationInfoMap.
   * Optionally associates citations with a specific message.
   */
  setCitedFiles: (citedFiles, messageId) => {
    set((state) => {
      // Update legacy map (backward compatibility)
      const newFileMap = new Map(state.citationFileMap);
      // Update rich info map
      const newInfoMap = new Map(state.citationInfoMap);
      // Build citation list for this message
      const citations: CitationInfo[] = [];

      for (const file of citedFiles) {
        // Legacy map only stores files with valid IDs
        if (file.fileId) {
          newFileMap.set(file.fileName, file.fileId);
        }

        // Rich info for all files (including tombstones)
        const citationInfo: CitationInfo = {
          fileName: file.fileName,
          fileId: file.fileId,
          sourceType: file.sourceType,
          mimeType: file.mimeType,
          relevanceScore: file.relevanceScore,
          isImage: file.isImage,
          fetchStrategy: file.fetchStrategy,
          isDeleted: file.fileId === null,
        };

        newInfoMap.set(file.fileName, citationInfo);
        citations.push(citationInfo);
      }

      // Update message citations if messageId provided
      const newMessageCitations = new Map(state.messageCitations);
      if (messageId) {
        newMessageCitations.set(messageId, citations);
      }

      return {
        citationFileMap: newFileMap,
        citationInfoMap: newInfoMap,
        messageCitations: newMessageCitations,
      };
    });
  },

  getCitationInfo: (fileName) => {
    return get().citationInfoMap.get(fileName);
  },

  getMessageCitations: (messageId) => {
    return get().messageCitations.get(messageId) ?? [];
  },

  /**
   * Hydrate citations from API response (page load).
   * Called when loading historical messages to restore citation state.
   */
  hydrateFromMessages: (messages) => {
    set((state) => {
      const newFileMap = new Map(state.citationFileMap);
      const newInfoMap = new Map(state.citationInfoMap);
      const newMessageCitations = new Map(state.messageCitations);

      for (const message of messages) {
        if (!message.citedFiles || message.citedFiles.length === 0) continue;

        const infos: CitationInfo[] = [];
        for (const file of message.citedFiles) {
          // Update legacy file map
          if (file.fileId) {
            newFileMap.set(file.fileName, file.fileId);
          }

          // Create citation info
          const info: CitationInfo = {
            fileName: file.fileName,
            fileId: file.fileId,
            sourceType: file.sourceType,
            mimeType: file.mimeType,
            relevanceScore: file.relevanceScore,
            isImage: file.isImage,
            fetchStrategy: file.fetchStrategy,
            isDeleted: file.fileId === null,
          };

          newInfoMap.set(file.fileName, info);
          infos.push(info);
        }

        // Associate citations with message
        newMessageCitations.set(message.id, infos);
      }

      return {
        citationFileMap: newFileMap,
        citationInfoMap: newInfoMap,
        messageCitations: newMessageCitations,
      };
    });
  },

  clearCitations: () => {
    set({
      citationFileMap: new Map(),
      citationInfoMap: new Map(),
      messageCitations: new Map(),
    });
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
