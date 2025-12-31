/**
 * @module domains/agent/streaming
 *
 * Streaming domain for the agent orchestration system.
 * Contains accumulator utilities (used by other modules).
 *
 * NOTE: GraphStreamProcessor and StreamEventRouter have been removed.
 * Use AgentOrchestrator.executeAgentSync() instead.
 */

// Types
export * from './types';

// Accumulator utilities (still used)
export {
  ThinkingAccumulator,
  createThinkingAccumulator,
} from './ThinkingAccumulator';

export {
  ContentAccumulator,
  createContentAccumulator,
} from './ContentAccumulator';
