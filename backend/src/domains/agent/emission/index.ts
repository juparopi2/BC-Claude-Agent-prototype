/**
 * @module domains/agent/emission
 *
 * Event emission domain for the agent orchestration system.
 * Handles WebSocket event emission with proper ordering.
 *
 * Implemented Classes:
 * - EventIndexTracker: Counter for event ordering (~30 LOC)
 * - AgentEventEmitter: Unified event emission (~80 LOC)
 */

// Types
export * from './types';

// Implemented classes
export {
  EventIndexTracker,
  createEventIndexTracker,
} from './EventIndexTracker';

export {
  AgentEventEmitter,
  createAgentEventEmitter,
} from './AgentEventEmitter';
