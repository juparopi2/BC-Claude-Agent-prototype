/**
 * @module domains/agent/emission
 *
 * Event emission domain for the agent orchestration system.
 *
 * NOTE: AgentEventEmitter has been removed.
 * Event emission is now handled directly in AgentOrchestrator.executeAgentSync().
 *
 * Remaining:
 * - EventIndexTracker: Counter for event ordering (used internally)
 */

// Types
export * from './types';

// EventIndexTracker (still used by orchestrator)
export {
  EventIndexTracker,
  createEventIndexTracker,
} from './EventIndexTracker';
