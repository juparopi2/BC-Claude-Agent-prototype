/**
 * @module domains/agent/tools
 *
 * Tool execution domain for the agent orchestration system.
 * Handles tool deduplication, execution, and approval flow.
 *
 * Implemented Classes:
 * - ToolEventDeduplicator: Prevents duplicate tool events (~50 LOC)
 * - ToolExecutionProcessor: Processes tool executions (~100 LOC)
 */

// Types
export * from './types';

// ToolEventDeduplicator
export {
  ToolEventDeduplicator,
  createToolEventDeduplicator,
} from './ToolEventDeduplicator';

// ToolExecutionProcessor
export {
  ToolExecutionProcessor,
  createToolExecutionProcessor,
  getToolExecutionProcessor,
  __resetToolExecutionProcessor,
} from './ToolExecutionProcessor';
