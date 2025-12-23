/**
 * @module domains/agent/emission/types
 *
 * Types for agent event emission.
 * Used by AgentEventEmitter and EventIndexTracker.
 */

import type { AgentEvent } from '@bc-agent/shared';

/**
 * Event with index added for frontend sorting.
 * Extends any AgentEvent with an eventIndex property.
 */
export interface IndexedAgentEvent extends AgentEvent {
  /** Index for ordering events without sequence numbers */
  eventIndex: number;
}

/**
 * Interface for EventIndexTracker.
 * Simple counter for event ordering.
 */
export interface IEventIndexTracker {
  /** Get the next event index (auto-increments) */
  next(): number;

  /** Get current index without incrementing */
  current(): number;

  /** Reset counter to 0 (for new sessions) */
  reset(): void;
}

/**
 * Callback type for event emission.
 */
export type EventEmitCallback = (event: AgentEvent) => void;

/**
 * Interface for AgentEventEmitter.
 * Handles event emission with index tracking.
 */
export interface IAgentEventEmitter {
  /** Set the callback for event emission */
  setCallback(callback: EventEmitCallback | undefined): void;

  /** Emit an event with auto-incrementing index */
  emit(event: AgentEvent | null): void;

  /** Emit an error event */
  emitError(sessionId: string, error: string, code: string): void;

  /** Emit user_message_confirmed event after persistence */
  emitUserMessageConfirmed(
    sessionId: string,
    data: {
      messageId: string;
      sequenceNumber: number;
      eventId: string;
      content: string;
      userId: string;
    }
  ): void;

  /** Get current event index */
  getEventIndex(): number;

  /** Reset emitter state */
  reset(): void;
}
