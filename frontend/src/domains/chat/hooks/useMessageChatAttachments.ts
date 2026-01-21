/**
 * useMessageChatAttachments Hook
 *
 * Provides access to chat attachments associated with messages in history.
 * Used for displaying attachment thumbnails/icons in the message bubble.
 *
 * This is different from useChatAttachments which manages upload state.
 * This hook is for reading persisted attachment relationships from history.
 *
 * @module domains/chat/hooks/useMessageChatAttachments
 */

import { useCallback, useMemo } from 'react';
import { useChatAttachmentStore } from '../stores/chatAttachmentStore';
import type { ChatAttachmentSummary, Message } from '@bc-agent/shared';

/**
 * Return type for useMessageChatAttachments hook
 */
export interface UseMessageChatAttachmentsReturn {
  /** Get attachments for a specific message */
  getAttachments: (messageId: string) => ChatAttachmentSummary[];
  /** Check if a message has attachments */
  hasAttachments: (messageId: string) => boolean;
  /** Hydrate store from API response (page load) */
  hydrateFromMessages: (messages: Array<Message & { chatAttachments?: ChatAttachmentSummary[] }>) => void;
  /** Set attachments for a specific message (from WebSocket event) */
  setMessageAttachments: (messageId: string, attachments: ChatAttachmentSummary[]) => void;
  /** Set attachment IDs for a message (from WebSocket event, to be resolved later) */
  setMessageAttachmentIds: (messageId: string, attachmentIds: string[]) => void;
  /** Clear all attachment state */
  clearAttachments: () => void;
}

/**
 * Hook for accessing chat attachments associated with messages in history.
 *
 * @example
 * ```tsx
 * const { getAttachments, hasAttachments, hydrateFromMessages } = useMessageChatAttachments();
 *
 * // Hydrate from API response on page load
 * useEffect(() => {
 *   if (messages) {
 *     hydrateFromMessages(messages);
 *   }
 * }, [messages, hydrateFromMessages]);
 *
 * // Render attachments in a message
 * const MessageWithAttachments = ({ message }) => {
 *   const attachments = getAttachments(message.id);
 *   if (!attachments.length) return null;
 *   return <MessageAttachmentCarousel attachments={attachments} />;
 * };
 * ```
 */
export function useMessageChatAttachments(): UseMessageChatAttachmentsReturn {
  // Subscribe to store state for reactivity
  const messageAttachments = useChatAttachmentStore((state) => state.messageAttachments);
  const storeActions = useChatAttachmentStore();

  /**
   * Get attachments for a specific message.
   * Memoized to prevent unnecessary re-renders.
   */
  const getAttachments = useCallback(
    (messageId: string): ChatAttachmentSummary[] => {
      return messageAttachments.get(messageId) ?? [];
    },
    [messageAttachments]
  );

  /**
   * Check if a message has attachments.
   */
  const hasAttachments = useCallback(
    (messageId: string): boolean => {
      const attachments = messageAttachments.get(messageId);
      return attachments !== undefined && attachments.length > 0;
    },
    [messageAttachments]
  );

  /**
   * Hydrate store from API response (page load).
   * Called when loading historical messages to restore attachment state.
   */
  const hydrateFromMessages = useCallback(
    (messages: Array<Message & { chatAttachments?: ChatAttachmentSummary[] }>) => {
      storeActions.hydrateFromMessages(messages);
    },
    [storeActions]
  );

  /**
   * Set attachments for a specific message (from WebSocket event).
   */
  const setMessageAttachments = useCallback(
    (messageId: string, attachments: ChatAttachmentSummary[]) => {
      storeActions.setMessageAttachments(messageId, attachments);
    },
    [storeActions]
  );

  /**
   * Set attachment IDs for a message (from WebSocket event, to be resolved later).
   * Creates placeholder summaries until full data is fetched.
   */
  const setMessageAttachmentIds = useCallback(
    (messageId: string, attachmentIds: string[]) => {
      storeActions.setMessageAttachmentIds(messageId, attachmentIds);
    },
    [storeActions]
  );

  /**
   * Clear all attachment state.
   */
  const clearAttachments = useCallback(() => {
    storeActions.clearAttachments();
  }, [storeActions]);

  return useMemo(
    () => ({
      getAttachments,
      hasAttachments,
      hydrateFromMessages,
      setMessageAttachments,
      setMessageAttachmentIds,
      clearAttachments,
    }),
    [
      getAttachments,
      hasAttachments,
      hydrateFromMessages,
      setMessageAttachments,
      setMessageAttachmentIds,
      clearAttachments,
    ]
  );
}
