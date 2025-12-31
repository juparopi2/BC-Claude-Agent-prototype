/**
 * @module domains/agent/tools
 *
 * Tool execution domain for the agent orchestration system.
 * Handles tool deduplication.
 *
 * NOTE: ToolExecutionProcessor has been removed.
 * Tool execution is now handled directly in AgentOrchestrator.executeAgentSync().
 */

// Types
export * from './types';

// ToolEventDeduplicator
export {
  ToolEventDeduplicator,
  createToolEventDeduplicator,
} from './ToolEventDeduplicator';
