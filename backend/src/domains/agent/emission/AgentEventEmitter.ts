/**
 * @module domains/agent/emission/AgentEventEmitter
 *
 * Handles unified event emission with index tracking.
 * Extracted from DirectAgentService.runGraph() emitEvent function.
 *
 * ## Stateless Architecture
 *
 * This emitter is STATELESS - all mutable state lives in ExecutionContext:
 * - ctx.callback: The function to receive emitted events
 * - ctx.eventIndex: Auto-incrementing index for event ordering
 *
 * This enables:
 * - Multi-tenant isolation (no shared state between executions)
 * - Horizontal scaling in Azure Container Apps
 * - No cleanup required between executions
 *
 * @example
 * ```typescript
 * const ctx = createExecutionContext(sessionId, userId, (event) => socket.emit('agent:event', event));
 * const emitter = getAgentEventEmitter();
 *
 * emitter.emit({ type: 'message_chunk', content: 'Hello' }, ctx);
 * // Callback receives: { type: 'message_chunk', content: 'Hello', eventIndex: 0 }
 * ```
 */

import type { AgentEvent } from '@bc-agent/shared';
import type { IAgentEventEmitter } from './types';
import type { ExecutionContext } from '@domains/agent/orchestration/ExecutionContext';

/**
 * Emits agent events with automatic index tracking.
 * STATELESS - all state lives in ExecutionContext.
 * Thread-safe for concurrent executions.
 */
export class AgentEventEmitter implements IAgentEventEmitter {
  // NO instance fields - completely stateless

  /**
   * Emit an event with auto-incrementing index.
   * Null events are silently ignored.
   *
   * @param event - The event to emit (null is ignored)
   * @param ctx - Execution context with callback and eventIndex
   */
  emit(event: AgentEvent | null, ctx: ExecutionContext): void {
    if (event && ctx.callback) {
      const eventWithIndex = {
        ...event,
        eventIndex: ctx.eventIndex++, // Increment in context
      };
      ctx.callback(eventWithIndex);
    }
  }

  /**
   * Emit user_message_confirmed event.
   * Called after user message is persisted to EventStore.
   *
   * @param sessionId - The session ID
   * @param data - Message persistence data
   * @param ctx - Execution context
   */
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
  ): void {
    this.emit(
      {
        type: 'user_message_confirmed',
        sessionId,
        messageId: data.messageId,
        sequenceNumber: data.sequenceNumber,
        eventId: data.eventId,
        content: data.content,
        userId: data.userId,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      },
      ctx
    );
  }

  /**
   * Emit an error event.
   * Convenience method for error emission.
   *
   * @param sessionId - The session ID
   * @param error - Error message
   * @param code - Error code
   * @param ctx - Execution context
   */
  emitError(sessionId: string, error: string, code: string, ctx: ExecutionContext): void {
    this.emit(
      {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        error,
        code,
      },
      ctx
    );
  }

  /**
   * Get current event index (without incrementing).
   * @param ctx - Execution context
   */
  getEventIndex(ctx: ExecutionContext): number {
    return ctx.eventIndex;
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let instance: AgentEventEmitter | null = null;

/**
 * Get the singleton AgentEventEmitter instance.
 * Safe for concurrent use because all state lives in ExecutionContext.
 */
export function getAgentEventEmitter(): AgentEventEmitter {
  if (!instance) {
    instance = new AgentEventEmitter();
  }
  return instance;
}

/**
 * Create a new AgentEventEmitter instance.
 * @deprecated Use getAgentEventEmitter() for production.
 * Only use this for testing with dependency injection.
 */
export function createAgentEventEmitter(): AgentEventEmitter {
  return new AgentEventEmitter();
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetAgentEventEmitter(): void {
  instance = null;
}
