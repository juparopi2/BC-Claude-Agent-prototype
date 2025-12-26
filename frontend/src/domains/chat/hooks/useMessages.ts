/**
 * useMessages Hook
 *
 * Provides access to chat messages with sorted output and optimistic update support.
 * Encapsulates messageStore access for cleaner component code.
 *
 * @module domains/chat/hooks/useMessages
 */

import { useMemo, useCallback } from 'react';
import type { Message } from '@bc-agent/shared';
import {
  useMessageStore,
  getMessageStore,
  type MessageState,
} from '../stores/messageStore';

/**
 * Return type for useMessages hook
 */
export interface UseMessagesReturn {
  /** All messages (persisted + optimistic), sorted by sequence */
  messages: Message[];
  /** Whether there are no messages */
  isEmpty: boolean;
  /** Add an optimistic message pending confirmation */
  addOptimistic: (tempId: string, message: Message) => void;
  /** Confirm an optimistic message with server data */
  confirmOptimistic: (tempId: string, confirmed: Message) => void;
  /** Remove an optimistic message (e.g., on error) */
  removeOptimistic: (tempId: string) => void;
}

/**
 * Extended message type for sorting.
 */
type SortableMessage = Message & {
  eventIndex?: number;
  blockIndex?: number;
};

/**
 * Sort messages by sequence_number, with fallback to timestamp.
 */
function sortMessages(a: SortableMessage, b: SortableMessage): number {
  const seqA = a.sequence_number;
  const seqB = b.sequence_number;

  // Both have valid sequence numbers - sort by sequence
  if (seqA && seqA > 0 && seqB && seqB > 0) {
    return seqA - seqB;
  }

  // One is persisted, one isn't - persisted first
  if (seqA && seqA > 0) return -1;
  if (seqB && seqB > 0) return 1;

  // Both transient - use eventIndex/blockIndex
  const indexA = a.blockIndex ?? a.eventIndex ?? -1;
  const indexB = b.blockIndex ?? b.eventIndex ?? -1;

  if (indexA >= 0 && indexB >= 0 && indexA !== indexB) {
    return indexA - indexB;
  }

  // Fallback: timestamp
  const timeA = new Date(a.created_at).getTime();
  const timeB = new Date(b.created_at).getTime();
  return timeA - timeB;
}

/**
 * Select raw state for memoization.
 */
const selectMessages = (state: MessageState) => state.messages;
const selectOptimistic = (state: MessageState) => state.optimisticMessages;

/**
 * Hook for accessing chat messages.
 *
 * Provides sorted messages (persisted + optimistic) and actions for
 * optimistic updates.
 *
 * @returns Message state and actions
 *
 * @example
 * ```tsx
 * function ChatMessages() {
 *   const { messages, isEmpty } = useMessages();
 *
 *   if (isEmpty) {
 *     return <EmptyState />;
 *   }
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMessages(): UseMessagesReturn {
  // Select raw state (these are stable references from the store)
  const persistedMessages = useMessageStore(selectMessages);
  const optimisticMessages = useMessageStore(selectOptimistic);

  // Compute sorted messages with memoization
  const messages = useMemo(() => {
    const optimisticArray = Array.from(optimisticMessages.values());
    return [...persistedMessages, ...optimisticArray].sort(sortMessages);
  }, [persistedMessages, optimisticMessages]);

  // Compute isEmpty
  const isEmpty = messages.length === 0;

  // Stable action callbacks
  const addOptimistic = useCallback((tempId: string, message: Message) => {
    getMessageStore().getState().addOptimisticMessage(tempId, message);
  }, []);

  const confirmOptimistic = useCallback((tempId: string, confirmed: Message) => {
    getMessageStore().getState().confirmOptimisticMessage(tempId, confirmed);
  }, []);

  const removeOptimistic = useCallback((tempId: string) => {
    getMessageStore().getState().removeOptimisticMessage(tempId);
  }, []);

  return {
    messages,
    isEmpty,
    addOptimistic,
    confirmOptimistic,
    removeOptimistic,
  };
}
