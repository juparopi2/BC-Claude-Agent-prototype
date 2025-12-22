/**
 * @module domains/agent/emission/EventIndexTracker
 *
 * Simple counter for event ordering.
 * Extracted from DirectAgentService.runGraph() eventIndex counter.
 *
 * Used to provide ordering for transient events that don't have
 * sequence numbers yet (streaming chunks before persistence).
 *
 * @example
 * ```typescript
 * const tracker = new EventIndexTracker();
 * const idx1 = tracker.next(); // 0
 * const idx2 = tracker.next(); // 1
 * tracker.reset();
 * const idx3 = tracker.next(); // 0
 * ```
 */

import type { IEventIndexTracker } from './types';

/**
 * Tracks event index for ordering purposes.
 * Thread-safe within single Node.js event loop iteration.
 */
export class EventIndexTracker implements IEventIndexTracker {
  private index = 0;

  /**
   * Get the next event index and increment counter.
   * @returns Current index (then increments)
   */
  next(): number {
    return this.index++;
  }

  /**
   * Get current index without incrementing.
   * @returns Current index value
   */
  current(): number {
    return this.index;
  }

  /**
   * Reset counter to 0.
   * Call this when starting a new session or agent run.
   */
  reset(): void {
    this.index = 0;
  }
}

/**
 * Factory function to create EventIndexTracker.
 * Unlike services with singletons, this creates new instances
 * since each agent run needs its own counter.
 *
 * @returns New EventIndexTracker instance
 */
export function createEventIndexTracker(): EventIndexTracker {
  return new EventIndexTracker();
}
