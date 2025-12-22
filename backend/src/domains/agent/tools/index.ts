/**
 * @module domains/agent/tools
 *
 * Tool execution domain for the agent orchestration system.
 * Handles tool deduplication, execution, and approval flow.
 *
 * Implemented Classes:
 * - ToolEventDeduplicator: Prevents duplicate tool events (~50 LOC)
 *
 * TODO: Implement remaining classes:
 * - ToolExecutionProcessor: Processes tool executions (~100 LOC)
 */

// Types
export * from './types';

// Implemented classes
export {
  ToolEventDeduplicator,
  createToolEventDeduplicator,
} from './ToolEventDeduplicator';

// TODO: Export ToolExecutionProcessor when implemented
