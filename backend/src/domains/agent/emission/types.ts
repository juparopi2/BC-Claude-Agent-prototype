/**
 * @module domains/agent/emission/types
 *
 * Types for agent event emission.
 * Event emission is now handled directly in AgentOrchestrator.
 */

import type { AgentEvent } from '@bc-agent/shared';

/**
 * Event with index added for frontend sorting.
 * Extends any AgentEvent with an eventIndex property.
 */
export type IndexedAgentEvent = AgentEvent & {
  /** Index for ordering events without sequence numbers */
  eventIndex: number;
};

/**
 * Interface for EventIndexTracker.
 */
export interface IEventIndexTracker {
  /** Get the next event index (auto-increments) */
  next(): number;

  /** Get current index without incrementing */
  current(): number;

  /** Reset counter to 0 (for new sessions) */
  reset(): void;
}
