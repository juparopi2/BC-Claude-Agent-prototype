/**
 * EventRouter
 *
 * Routes WebSocket events to appropriate handlers with session filtering
 * and late-chunk protection.
 *
 * This component fixes Gap #6 by ignoring transient events (chunks)
 * that arrive after a 'complete' event.
 *
 * @module infrastructure/socket/eventRouter
 */

import type { AgentEvent } from '@bc-agent/shared';
import type { SocketClient } from './SocketClient';
import { isTransientEventType } from './types';

/**
 * Determines if an event type should be filtered after completion.
 *
 * Transient events like message_chunk and thinking_chunk should be
 * ignored if they arrive after the 'complete' event due to network
 * buffering or out-of-order delivery.
 */
function isTransientEvent(event: AgentEvent): boolean {
  return isTransientEventType(event.type);
}

/**
 * Routes agent events from SocketClient to handlers with filtering.
 *
 * Features:
 * - Session ID filtering: Only routes events for the current session
 * - Late chunk protection: Ignores transient events after 'complete'
 * - Clean reset: Can be reset when starting a new message
 *
 * @example
 * ```typescript
 * const router = new EventRouter();
 *
 * const unsubscribe = router.initialize(
 *   socketClient,
 *   'session-123',
 *   (event) => chatStore.handleAgentEvent(event)
 * );
 *
 * // When user sends a new message
 * router.reset();
 *
 * // When changing sessions
 * unsubscribe();
 * ```
 */
export class EventRouter {
  /**
   * Flag indicating the current turn is complete.
   * When true, transient events are filtered out.
   */
  private isComplete = false;

  /**
   * Initialize event routing from a SocketClient.
   *
   * @param socketClient The socket client to receive events from
   * @param sessionId The current session ID for filtering
   * @param onEvent Callback for valid events
   * @returns Unsubscribe function to stop routing
   */
  initialize(
    socketClient: SocketClient,
    sessionId: string,
    onEvent: (event: AgentEvent) => void
  ): () => void {
    return socketClient.onAgentEvent((event) => {
      // Filter by session ID if present
      if (event.sessionId && event.sessionId !== sessionId) {
        return;
      }

      // Guard: Ignore late transient events after complete (Gap #6 fix)
      if (this.isComplete && isTransientEvent(event)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[EventRouter] Ignored late transient event:', event.type);
        }
        return;
      }

      // Mark complete when we receive the complete event
      if (event.type === 'complete') {
        this.isComplete = true;
      }

      // Route the event
      onEvent(event);
    });
  }

  /**
   * Reset the router state.
   *
   * Call this when sending a new message to allow receiving
   * new transient events for the next turn.
   */
  reset(): void {
    this.isComplete = false;
  }

  /**
   * Check if the current turn is marked as complete.
   */
  get isCurrentTurnComplete(): boolean {
    return this.isComplete;
  }
}
