/**
 * @module domains/agent/emission/AgentEventEmitter
 *
 * Handles unified event emission with index tracking.
 * Extracted from DirectAgentService.runGraph() emitEvent function.
 *
 * Events are augmented with eventIndex for frontend sorting,
 * especially for transient events without sequence numbers.
 *
 * @example
 * ```typescript
 * const emitter = new AgentEventEmitter();
 * emitter.setCallback((event) => socket.emit('agent:event', event));
 *
 * emitter.emit({ type: 'message_chunk', content: 'Hello' });
 * // Callback receives: { type: 'message_chunk', content: 'Hello', eventIndex: 0 }
 * ```
 */

import type { AgentEvent } from '@bc-agent/shared';
import type {
  IAgentEventEmitter,
  IEventIndexTracker,
  EventEmitCallback,
} from './types';
import { EventIndexTracker } from './EventIndexTracker';

/**
 * Emits agent events with automatic index tracking.
 * Thread-safe within single Node.js event loop iteration.
 */
export class AgentEventEmitter implements IAgentEventEmitter {
  private callback: EventEmitCallback | undefined;
  private indexTracker: IEventIndexTracker;

  /**
   * Create a new AgentEventEmitter.
   * @param indexTracker - Optional custom index tracker (for testing)
   */
  constructor(indexTracker?: IEventIndexTracker) {
    this.indexTracker = indexTracker ?? new EventIndexTracker();
  }

  /**
   * Set the callback for event emission.
   * @param callback - Function to receive emitted events
   */
  setCallback(callback: EventEmitCallback | undefined): void {
    this.callback = callback;
  }

  /**
   * Emit an event with auto-incrementing index.
   * Null events are silently ignored.
   *
   * @param event - The event to emit (null is ignored)
   */
  emit(event: AgentEvent | null): void {
    if (event && this.callback) {
      const eventWithIndex = {
        ...event,
        eventIndex: this.indexTracker.next(),
      };
      this.callback(eventWithIndex);
    }
  }

  /**
   * Emit user_message_confirmed event.
   * Called after user message is persisted to EventStore.
   *
   * @param sessionId - The session ID
   * @param data - Message persistence data
   */
  emitUserMessageConfirmed(
    sessionId: string,
    data: {
      messageId: string;
      sequenceNumber: number;
      eventId: string;
      content: string;
      userId: string;
    }
  ): void {
    this.emit({
      type: 'user_message_confirmed',
      sessionId,
      messageId: data.messageId,
      sequenceNumber: data.sequenceNumber,
      eventId: data.eventId,
      content: data.content,
      userId: data.userId,
      timestamp: new Date().toISOString(),
      persistenceState: 'persisted',
    });
  }

  /**
   * Emit an error event.
   * Convenience method for error emission.
   *
   * @param sessionId - The session ID
   * @param error - Error message
   * @param code - Error code
   */
  emitError(sessionId: string, error: string, code: string): void {
    this.emit({
      type: 'error',
      sessionId,
      timestamp: new Date().toISOString(),
      error,
      code,
    });
  }

  /**
   * Get current event index (without incrementing).
   */
  getEventIndex(): number {
    return this.indexTracker.current();
  }

  /**
   * Reset emitter state for new session.
   */
  reset(): void {
    this.callback = undefined;
    this.indexTracker.reset();
  }

  /**
   * Check if callback is set.
   */
  hasCallback(): boolean {
    return this.callback !== undefined;
  }
}

/**
 * Factory function to create AgentEventEmitter.
 * Each agent run needs its own emitter.
 *
 * @returns New AgentEventEmitter instance
 */
export function createAgentEventEmitter(): AgentEventEmitter {
  return new AgentEventEmitter();
}
