/**
 * Message Metadata Store
 *
 * Unified store that manages per-message metadata:
 *   - Citations: file name / file ID mappings and rich citation info from RAG results
 *   - Attachments: chat attachments (files sent by the user with a message)
 *
 * Merged from citationStore.ts + chatAttachmentStore.ts so that a single
 * `hydrateFromMessages` call restores both citation and attachment state in one
 * pass when historical messages are loaded from the API.
 *
 * @module domains/chat/stores/messageMetadataStore
 */

import { create } from 'zustand';
import type { CitedFile, ChatAttachmentSummary } from '@bc-agent/shared';
import type { CitationInfo, CitationInfoMap } from '@/lib/types/citation.types';

// ============================================================
// Types — State
// ============================================================

/**
 * Map of file name -> file ID (legacy backward-compat format)
 */
export type CitationFileMap = Map<string, string>;

/**
 * Combined state for all per-message metadata.
 */
export interface MessageMetadataState {
  // ----- Citations -----
  /** Map of file name -> file ID (legacy, for backward compatibility) */
  citationFileMap: CitationFileMap;
  /** Map of file name -> CitationInfo (rich metadata) */
  citationInfoMap: CitationInfoMap;
  /** Map of message ID -> CitationInfo[] (per-message citations) */
  messageCitations: Map<string, CitationInfo[]>;

  // ----- Attachments -----
  /** Map of message ID -> ChatAttachmentSummary[] (per-message attachments) */
  messageAttachments: Map<string, ChatAttachmentSummary[]>;
}

// ============================================================
// Types — Hydration inputs
// ============================================================

/**
 * Message shape expected by citation-only hydration (backward compat)
 */
export interface MessageWithCitations {
  id: string;
  citedFiles?: CitedFile[];
}

/**
 * Message shape expected by attachment-only hydration (backward compat)
 */
export interface MessageWithChatAttachments {
  id: string;
  chatAttachments?: ChatAttachmentSummary[];
}

/**
 * Combined message shape for unified hydration.
 * Accepts a message that may carry either (or both) cited files and chat attachments.
 */
export interface MessageWithMetadata {
  id: string;
  citedFiles?: CitedFile[];
  chatAttachments?: ChatAttachmentSummary[];
}

// ============================================================
// Types — Actions
// ============================================================

/**
 * All actions exposed by the message metadata store.
 */
export interface MessageMetadataActions {
  // ----- Citation actions -----

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
  /** Clear all citations */
  clearCitations: () => void;

  // ----- Attachment actions -----

  /** Set attachments for a specific message (from WebSocket event) */
  setMessageAttachments: (messageId: string, attachments: ChatAttachmentSummary[]) => void;
  /** Set attachment IDs for a message (from WebSocket event, to be resolved later) */
  setMessageAttachmentIds: (messageId: string, attachmentIds: string[]) => void;
  /** Get attachments for a specific message */
  getMessageAttachments: (messageId: string) => ChatAttachmentSummary[];
  /** Check if a message has attachments */
  hasAttachments: (messageId: string) => boolean;
  /** Clear all attachments */
  clearAttachments: () => void;

  // ----- Unified -----

  /**
   * Hydrate both citations and attachments from API response in a single pass.
   * Call this when loading historical messages to restore all per-message metadata.
   */
  hydrateFromMessages: (messages: MessageWithMetadata[]) => void;

  /** Reset the entire store to initial state */
  reset: () => void;
}

/**
 * Combined store type
 */
export type MessageMetadataStore = MessageMetadataState & MessageMetadataActions;

// ============================================================
// Initial state
// ============================================================

const initialState: MessageMetadataState = {
  citationFileMap: new Map(),
  citationInfoMap: new Map(),
  messageCitations: new Map(),
  messageAttachments: new Map(),
};

// ============================================================
// Store
// ============================================================

/**
 * Message metadata store for managing per-message citations and attachments.
 *
 * @example
 * ```typescript
 * // Get file ID for a citation
 * const fileId = useMessageMetadataStore(s => s.getCitationFile('report.pdf'));
 *
 * // Get attachments for a message
 * const attachments = useMessageMetadataStore(s => s.getMessageAttachments(messageId));
 *
 * // Hydrate everything at once on page load
 * useMessageMetadataStore.getState().hydrateFromMessages(messages);
 * ```
 */
export const useMessageMetadataStore = create<MessageMetadataStore>((set, get) => ({
  ...initialState,

  // ------------------------------------------------------------------
  // Citation actions
  // ------------------------------------------------------------------

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

  clearCitations: () => {
    set({
      citationFileMap: new Map(),
      citationInfoMap: new Map(),
      messageCitations: new Map(),
    });
  },

  // ------------------------------------------------------------------
  // Attachment actions
  // ------------------------------------------------------------------

  setMessageAttachments: (messageId, attachments) => {
    set((state) => {
      const newMap = new Map(state.messageAttachments);
      newMap.set(messageId, attachments);
      return { messageAttachments: newMap };
    });
  },

  setMessageAttachmentIds: (messageId, attachmentIds) => {
    // Store attachment IDs as placeholder summaries until resolved.
    // This is used when we receive WebSocket events with just IDs;
    // the full summaries will be fetched when viewing the message history.
    set((state) => {
      const newMap = new Map(state.messageAttachments);
      const placeholders: ChatAttachmentSummary[] = attachmentIds.map((id) => ({
        id,
        name: '',
        mimeType: '',
        sizeBytes: 0,
        isImage: false,
        status: 'ready' as const,
      }));
      newMap.set(messageId, placeholders);
      return { messageAttachments: newMap };
    });
  },

  getMessageAttachments: (messageId) => {
    return get().messageAttachments.get(messageId) ?? [];
  },

  hasAttachments: (messageId) => {
    const attachments = get().messageAttachments.get(messageId);
    return attachments !== undefined && attachments.length > 0;
  },

  clearAttachments: () => {
    set({ messageAttachments: new Map() });
  },

  // ------------------------------------------------------------------
  // Unified hydration
  // ------------------------------------------------------------------

  /**
   * Hydrate both citations and attachments from API response in a single pass.
   * Called when loading historical messages to restore all per-message metadata.
   */
  hydrateFromMessages: (messages) => {
    set((state) => {
      // Citations
      const newFileMap = new Map(state.citationFileMap);
      const newInfoMap = new Map(state.citationInfoMap);
      const newMessageCitations = new Map(state.messageCitations);
      // Attachments
      const newAttachments = new Map(state.messageAttachments);

      for (const message of messages) {
        // Hydrate citations
        if (message.citedFiles && message.citedFiles.length > 0) {
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

        // Hydrate attachments
        if (message.chatAttachments && message.chatAttachments.length > 0) {
          newAttachments.set(message.id, message.chatAttachments);
        }
      }

      return {
        citationFileMap: newFileMap,
        citationInfoMap: newInfoMap,
        messageCitations: newMessageCitations,
        messageAttachments: newAttachments,
      };
    });
  },

  // ------------------------------------------------------------------
  // Reset
  // ------------------------------------------------------------------

  reset: () => {
    set(initialState);
  },
}));

// ============================================================
// Helper functions
// ============================================================

/**
 * Get the message metadata store instance (for non-React contexts).
 */
export function getMessageMetadataStore() {
  return useMessageMetadataStore;
}

/**
 * Reset message metadata store to initial state (for testing).
 */
export function resetMessageMetadataStore() {
  useMessageMetadataStore.setState(initialState);
}

// ============================================================
// Backward-compatible function aliases
// ============================================================

/** @deprecated Use getMessageMetadataStore */
export const getCitationStore = getMessageMetadataStore;

/** @deprecated Use useMessageMetadataStore */
export const useCitationStore = useMessageMetadataStore;

/** @deprecated Use resetMessageMetadataStore */
export const resetCitationStore = resetMessageMetadataStore;

/** @deprecated Use getMessageMetadataStore */
export const getChatAttachmentStore = getMessageMetadataStore;

/** @deprecated Use useMessageMetadataStore */
export const useChatAttachmentStore = useMessageMetadataStore;

/** @deprecated Use resetMessageMetadataStore */
export const resetChatAttachmentStore = resetMessageMetadataStore;

// ============================================================
// Backward-compatible type aliases
// ============================================================

/** @deprecated Use MessageMetadataState */
export type CitationState = MessageMetadataState;
/** @deprecated Use MessageMetadataActions */
export type CitationActions = MessageMetadataActions;
/** @deprecated Use MessageMetadataStore */
export type CitationStore = MessageMetadataStore;

/** @deprecated Use MessageMetadataState */
export type ChatAttachmentState = MessageMetadataState;
/** @deprecated Use MessageMetadataActions */
export type ChatAttachmentActions = MessageMetadataActions;
/** @deprecated Use MessageMetadataStore */
export type ChatAttachmentStore = MessageMetadataStore;
