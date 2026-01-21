/**
 * @module domains/agent/orchestration/events/EventSequencer
 *
 * Handles sequence number pre-allocation and assignment for events.
 * Extracted from AgentOrchestrator (lines 346-380).
 *
 * ## Purpose
 *
 * Sequence numbers are pre-allocated atomically via Redis INCRBY before
 * processing events. This fixes a race condition where async tool events
 * would get sequence numbers after sync events had already been emitted.
 *
 * ## Process
 *
 * 1. Count events needing persistence (non-transient)
 * 2. Reserve sequences atomically from EventStore
 * 3. Assign sequences to events in order
 *
 * @example
 * ```typescript
 * const count = countPersistableEvents(events);
 * const sequences = await eventStore.reserveSequenceNumbers(sessionId, count);
 * assignPreAllocatedSequences(events, sequences);
 * ```
 */

import type { NormalizedAgentEvent } from '@bc-agent/shared';

/**
 * Count events that need persistence (non-transient events).
 * Each such event requires exactly one sequence number.
 *
 * @param events - Array of normalized events
 * @returns Number of events requiring persistence
 */
export function countPersistableEvents(events: NormalizedAgentEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (event.persistenceStrategy !== 'transient') {
      count++;
    }
  }
  return count;
}

/**
 * Assign pre-allocated sequence numbers to events in order.
 * Only non-transient events receive sequences.
 *
 * IMPORTANT: This mutates the events array in place by setting
 * preAllocatedSequenceNumber on each non-transient event.
 *
 * @param events - Array of normalized events (will be mutated)
 * @param sequences - Pre-allocated sequence numbers from EventStore
 * @returns Map of eventId -> assigned sequence (for debugging)
 */
export function assignPreAllocatedSequences(
  events: NormalizedAgentEvent[],
  sequences: number[]
): Map<string, number> {
  const assignments = new Map<string, number>();
  let seqIndex = 0;

  for (const event of events) {
    if (event.persistenceStrategy !== 'transient') {
      const seq = sequences[seqIndex++];
      event.preAllocatedSequenceNumber = seq;
      assignments.set(event.eventId, seq);
    }
  }

  return assignments;
}

/**
 * Interface for EventStore sequence reservation.
 * Used for dependency injection in testing.
 */
export interface ISequenceReserver {
  reserveSequenceNumbers(sessionId: string, count: number): Promise<number[]>;
}

/**
 * Reserve and assign sequences in one operation.
 * Convenience function that combines counting, reserving, and assigning.
 *
 * @param events - Array of normalized events (will be mutated)
 * @param sessionId - Session ID for sequence reservation
 * @param eventStore - EventStore instance for sequence reservation
 * @returns Map of eventId -> assigned sequence
 */
export async function reserveAndAssignSequences(
  events: NormalizedAgentEvent[],
  sessionId: string,
  eventStore: ISequenceReserver
): Promise<Map<string, number>> {
  const count = countPersistableEvents(events);

  if (count === 0) {
    return new Map();
  }

  const sequences = await eventStore.reserveSequenceNumbers(sessionId, count);
  return assignPreAllocatedSequences(events, sequences);
}

/**
 * Generate debug info for sequence assignments.
 * Useful for logging and debugging sequence issues.
 *
 * @param events - Array of normalized events
 * @returns Array of objects with type and sequence for each event
 */
export function getSequenceDebugInfo(
  events: NormalizedAgentEvent[]
): Array<{ type: string; seq: number | undefined }> {
  return events.map((e) => ({
    type: e.type,
    seq: e.preAllocatedSequenceNumber,
  }));
}
