/**
 * @module domains/agent/emission/types
 *
 * Types for agent event emission.
 *
 * ## Stateless Architecture
 *
 * AgentEventEmitter is STATELESS - the callback and eventIndex
 * are stored in ExecutionContext, not in the emitter.
 */

import type { AgentEvent } from '@bc-agent/shared';
import type { ExecutionContext } from '@domains/agent/orchestration/ExecutionContext';

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
 * @deprecated Use ExecutionContext.eventIndex instead
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
 * Re-exported from ExecutionContext for convenience.
 */
export type { EventEmitCallback } from '@domains/agent/orchestration/ExecutionContext';

/**
 * Interface for AgentEventEmitter (Stateless).
 * All methods receive ExecutionContext which contains the callback and eventIndex.
 */
export interface IAgentEventEmitter {
  /** Emit an event with auto-incrementing index */
  emit(event: AgentEvent | null, ctx: ExecutionContext): void;

  /** Emit an error event */
  emitError(sessionId: string, error: string, code: string, ctx: ExecutionContext): void;

  /** Emit user_message_confirmed event after persistence */
  emitUserMessageConfirmed(
    sessionId: string,
    data: {
      messageId: string;
      sequenceNumber: number;
      eventId: string;
      content: string;
      userId: string;
    },
    ctx: ExecutionContext
  ): void;

  /** Get current event index from context */
  getEventIndex(ctx: ExecutionContext): number;
}
