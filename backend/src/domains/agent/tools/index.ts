/**
 * @module domains/agent/tools
 *
 * Tool execution domain for the agent orchestration system.
 * Handles tool deduplication and lifecycle management.
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

// ToolLifecycleManager - Unified tool persistence
export {
  ToolLifecycleManager,
  createToolLifecycleManager,
} from './ToolLifecycleManager';

// Tool args normalization helper
export { normalizeToolArgs } from './normalizeToolArgs';
