/**
 * useSendMessage Hook
 *
 * Provides message sending functionality with optimistic updates.
 * Wraps useSocketConnection for a focused send-centric API.
 *
 * @module domains/chat/hooks/useSendMessage
 */

import { useCallback, useMemo } from 'react';
import { useSocketConnection } from './useSocketConnection';
import { useMessageStore, type MessageStore } from '../stores/messageStore';

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** File attachments */
  attachments?: string[];
  /** Enable extended thinking */
  enableThinking?: boolean;
  /** Token budget for thinking (1024-100000) */
  thinkingBudget?: number;
  /** Enable automatic semantic search */
  enableAutoSemanticSearch?: boolean;
}

/**
 * Return type for useSendMessage hook
 */
export interface UseSendMessageReturn {
  /** Send a message with optional settings */
  sendMessage: (content: string, options?: SendMessageOptions) => void;
  /** Stop the running agent */
  stopAgent: () => void;
  /** Whether socket is connected */
  isConnected: boolean;
  /** Whether session is ready (connected + joined room) */
  isSessionReady: boolean;
  /** Whether reconnecting (has pending messages) */
  isReconnecting: boolean;
  /** Whether we have pending optimistic messages */
  isSending: boolean;
}

// Selector for optimistic messages
const selectOptimisticMessages = (state: MessageStore) => state.optimisticMessages;

/**
 * Hook for sending chat messages.
 *
 * Provides a focused API for message sending with optimistic update tracking.
 * Uses useSocket internally for WebSocket connection management.
 *
 * @param sessionId - The session to send messages to
 * @returns Send actions and connection state
 *
 * @example
 * ```tsx
 * function MessageInput({ sessionId }: { sessionId: string }) {
 *   const { sendMessage, isConnected, isSending } = useSendMessage(sessionId);
 *   const [text, setText] = useState('');
 *
 *   const handleSubmit = () => {
 *     if (text.trim() && isConnected && !isSending) {
 *       sendMessage(text, { enableThinking: true });
 *       setText('');
 *     }
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <input value={text} onChange={e => setText(e.target.value)} />
 *       <button disabled={!isConnected || isSending}>
 *         {isSending ? 'Sending...' : 'Send'}
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useSendMessage(sessionId: string): UseSendMessageReturn {
  // Use socket connection hook for connection management
  const {
    sendMessage: socketSendMessage,
    stopAgent,
    isConnected,
    isSessionReady,
    isReconnecting,
  } = useSocketConnection({
    sessionId,
    autoConnect: true,
  });

  // Track pending optimistic messages
  const optimisticMessages = useMessageStore(selectOptimisticMessages);
  const isSending = optimisticMessages.size > 0;

  // Wrap sendMessage with our options interface
  const sendMessage = useCallback(
    (content: string, options?: SendMessageOptions) => {
      if (!content.trim()) {
        return;
      }

      socketSendMessage(content, {
        enableThinking: options?.enableThinking,
        thinkingBudget: options?.thinkingBudget,
        attachments: options?.attachments,
        enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
      });
    },
    [socketSendMessage]
  );

  // Memoize return object
  return useMemo(
    () => ({
      sendMessage,
      stopAgent,
      isConnected,
      isSessionReady,
      isReconnecting,
      isSending,
    }),
    [sendMessage, stopAgent, isConnected, isSessionReady, isReconnecting, isSending]
  );
}
