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
import { sortMessages } from '../utils/messageSort';

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
