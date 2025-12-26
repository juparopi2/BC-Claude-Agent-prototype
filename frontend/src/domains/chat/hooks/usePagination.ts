/**
 * usePagination Hook
 *
 * Provides pagination functionality for loading older messages.
 * Uses cursor-based pagination with sequence numbers.
 *
 * @module domains/chat/hooks/usePagination
 */

import { useState, useCallback, useMemo } from 'react';
import type { Message } from '@bc-agent/shared';
import { api } from '@/lib/services/api';
import { getMessageStore } from '../stores/messageStore';

/**
 * Return type for usePagination hook
 */
export interface UsePaginationReturn {
  /** Load older messages before the oldest current message */
  loadOlderMessages: () => Promise<void>;
  /** Whether more older messages may exist */
  hasMore: boolean;
  /** Whether currently loading more messages */
  isLoadingMore: boolean;
  /** Error from last load attempt */
  error: string | null;
  /** The oldest sequence number in current messages */
  oldestSequenceNumber: number | null;
}

/**
 * Default page size for loading messages
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Hook for paginating chat messages.
 *
 * Provides functionality to load older messages using cursor-based pagination.
 * Uses sequence_number as the cursor for consistent ordering.
 *
 * @param sessionId - The session ID to load messages for
 * @param pageSize - Number of messages to load per page (default: 50)
 * @returns Pagination state and actions
 *
 * @example
 * ```tsx
 * function ChatMessages({ sessionId }) {
 *   const { messages } = useMessages();
 *   const { loadOlderMessages, hasMore, isLoadingMore } = usePagination(sessionId);
 *
 *   return (
 *     <div>
 *       {hasMore && (
 *         <button onClick={loadOlderMessages} disabled={isLoadingMore}>
 *           {isLoadingMore ? 'Loading...' : 'Load More'}
 *         </button>
 *       )}
 *       {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePagination(
  sessionId: string | null | undefined,
  pageSize: number = DEFAULT_PAGE_SIZE
): UsePaginationReturn {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Compute the oldest sequence number from current messages.
   * Returns null if no messages or no persisted messages with sequence numbers.
   */
  const oldestSequenceNumber = useMemo(() => {
    const messages = getMessageStore().getState().messages;
    if (messages.length === 0) return null;

    // Find the minimum sequence number (excluding null/0)
    const sequenceNumbers = messages
      .map((m) => m.sequence_number)
      .filter((seq): seq is number => typeof seq === 'number' && seq > 0);

    if (sequenceNumbers.length === 0) return null;
    return Math.min(...sequenceNumbers);
  }, []);

  /**
   * Load older messages before the current oldest message.
   */
  const loadOlderMessages = useCallback(async () => {
    if (!sessionId) {
      setError('No session ID provided');
      return;
    }

    if (isLoadingMore) {
      return; // Prevent duplicate requests
    }

    if (!hasMore) {
      return; // No more messages to load
    }

    setIsLoadingMore(true);
    setError(null);

    try {
      // Get current oldest sequence number from store
      const messages = getMessageStore().getState().messages;
      const currentOldest = messages
        .map((m) => m.sequence_number)
        .filter((seq): seq is number => typeof seq === 'number' && seq > 0);

      const beforeCursor = currentOldest.length > 0
        ? Math.min(...currentOldest)
        : undefined;

      // Fetch older messages
      const result = await api.getMessages(sessionId, {
        limit: pageSize,
        before: beforeCursor,
      });

      if (!result.success) {
        setError(result.error || 'Failed to load messages');
        return;
      }

      const olderMessages = result.data || [];

      // If we got fewer messages than requested, there are no more
      if (olderMessages.length < pageSize) {
        setHasMore(false);
      }

      // Prepend older messages to the store
      if (olderMessages.length > 0) {
        const store = getMessageStore().getState();

        // Add each message (store will deduplicate)
        for (const message of olderMessages) {
          store.addMessage(message);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('[usePagination] Error loading messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [sessionId, pageSize, isLoadingMore, hasMore]);

  return {
    loadOlderMessages,
    hasMore,
    isLoadingMore,
    error,
    oldestSequenceNumber,
  };
}
