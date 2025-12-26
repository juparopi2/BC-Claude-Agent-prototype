/**
 * Message Sorting Utility
 *
 * Centralized sorting logic for chat messages.
 * Handles persisted messages (with sequence_number) and transient messages
 * (streaming chunks with eventIndex/blockIndex).
 *
 * @module domains/chat/utils/messageSort
 */

import type { Message } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended message type for sorting that includes transient event properties.
 * Used internally for sorting messages that may have streaming metadata.
 */
export type SortableMessage = Message & {
  /** Event index for ordering streaming chunks */
  eventIndex?: number;
  /** Block index for ordering thinking blocks */
  blockIndex?: number;
};

// ============================================================================
// Sorting Function
// ============================================================================

/**
 * Sort messages by sequence_number, with fallback to timestamp.
 *
 * Sorting Rules:
 * 1. Persisted messages (sequence_number > 0) sorted by sequence_number
 * 2. Persisted messages come before transient (no sequence_number)
 * 3. Transient messages sorted by eventIndex/blockIndex if available
 * 4. Fallback to created_at timestamp
 *
 * @param a - First message to compare
 * @param b - Second message to compare
 * @returns Negative if a < b, positive if a > b, zero if equal
 *
 * @example
 * const sorted = messages.sort(sortMessages);
 */
export function sortMessages(a: SortableMessage, b: SortableMessage): number {
  const seqA = a.sequence_number;
  const seqB = b.sequence_number;

  // State 1: Both have valid sequence numbers - sort by sequence
  if (seqA && seqA > 0 && seqB && seqB > 0) {
    return seqA - seqB;
  }

  // State 2: One is persisted, one isn't - persisted first
  if (seqA && seqA > 0) return -1;
  if (seqB && seqB > 0) return 1;

  // State 3: Both transient - use eventIndex/blockIndex
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
 * Sort an array of messages in place.
 * Convenience wrapper around sortMessages.
 *
 * @param messages - Array of messages to sort
 * @returns The same array, sorted
 */
export function sortMessagesInPlace<T extends SortableMessage>(
  messages: T[]
): T[] {
  return messages.sort(sortMessages);
}
