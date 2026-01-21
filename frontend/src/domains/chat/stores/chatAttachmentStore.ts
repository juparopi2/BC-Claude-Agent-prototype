/**
 * Chat Attachment Store
 *
 * Manages the mapping between user messages and their chat attachments.
 * Used for displaying attachment thumbnails/icons in message history.
 *
 * @module domains/chat/stores/chatAttachmentStore
 */

import { create } from 'zustand';
import type { ChatAttachmentSummary } from '@bc-agent/shared';

/**
 * Chat attachment state
 */
export interface ChatAttachmentState {
  /** Map of message ID -> ChatAttachmentSummary[] (per-message attachments) */
  messageAttachments: Map<string, ChatAttachmentSummary[]>;
}

/**
 * Message with optional chat attachments from API response
 */
export interface MessageWithChatAttachments {
  id: string;
  chatAttachments?: ChatAttachmentSummary[];
}

/**
 * Chat attachment actions
 */
export interface ChatAttachmentActions {
  /** Set attachments for a specific message (from WebSocket event) */
  setMessageAttachments: (messageId: string, attachments: ChatAttachmentSummary[]) => void;

  /** Set attachment IDs for a message (from WebSocket event, to be resolved later) */
  setMessageAttachmentIds: (messageId: string, attachmentIds: string[]) => void;

  /** Get attachments for a specific message */
  getMessageAttachments: (messageId: string) => ChatAttachmentSummary[];

  /** Check if a message has attachments */
  hasAttachments: (messageId: string) => boolean;

  /** Hydrate attachments from API response (page load) */
  hydrateFromMessages: (messages: MessageWithChatAttachments[]) => void;

  /** Clear all attachments */
  clearAttachments: () => void;

  /** Reset to initial state */
  reset: () => void;
}

/**
 * Combined chat attachment store type
 */
export type ChatAttachmentStore = ChatAttachmentState & ChatAttachmentActions;

/**
 * Initial state
 */
const initialState: ChatAttachmentState = {
  messageAttachments: new Map(),
};

/**
 * Chat attachment store for managing message-to-attachment mappings.
 *
 * @example
 * ```typescript
 * // Get attachments for a message
 * const attachments = useChatAttachmentStore(s => s.getMessageAttachments(messageId));
 *
 * // Hydrate from API response
 * const { hydrateFromMessages } = useChatAttachmentStore();
 * hydrateFromMessages(messages);
 * ```
 */
export const useChatAttachmentStore = create<ChatAttachmentStore>((set, get) => ({
  ...initialState,

  setMessageAttachments: (messageId, attachments) => {
    set((state) => {
      const newMap = new Map(state.messageAttachments);
      newMap.set(messageId, attachments);
      return { messageAttachments: newMap };
    });
  },

  setMessageAttachmentIds: (messageId, attachmentIds) => {
    // Store attachment IDs as placeholder summaries until resolved
    // This is used when we receive WebSocket events with just IDs
    // The full summaries will be fetched when viewing the message history
    set((state) => {
      const newMap = new Map(state.messageAttachments);
      // Create placeholder summaries with just IDs
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

  /**
   * Hydrate attachments from API response (page load).
   * Called when loading historical messages to restore attachment state.
   */
  hydrateFromMessages: (messages) => {
    set((state) => {
      const newMap = new Map(state.messageAttachments);

      for (const message of messages) {
        if (!message.chatAttachments || message.chatAttachments.length === 0) {
          continue;
        }

        // Store attachments for this message
        newMap.set(message.id, message.chatAttachments);
      }

      return { messageAttachments: newMap };
    });
  },

  clearAttachments: () => {
    set({ messageAttachments: new Map() });
  },

  reset: () => {
    set(initialState);
  },
}));

/**
 * Get the chat attachment store instance (for non-React contexts)
 */
export function getChatAttachmentStore() {
  return useChatAttachmentStore;
}

/**
 * Reset chat attachment store to initial state (for testing)
 */
export function resetChatAttachmentStore() {
  useChatAttachmentStore.setState(initialState);
}
