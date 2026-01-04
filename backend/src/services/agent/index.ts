/**
 * Agent Service Exports
 *
 * Re-exports from @domains/agent/orchestration for backward compatibility.
 * The DirectAgentService has been refactored into AgentOrchestrator
 * with modular, single-responsibility classes.
 */

export {
  AgentOrchestrator,
  getAgentOrchestrator,
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration';

// Re-export types for consumers
export type {
  IAgentOrchestrator,
  ExecuteSyncOptions,
  AgentOrchestratorDependencies,
} from '@domains/agent/orchestration';

// Backward compatibility alias
export { getAgentOrchestrator as getDirectAgentService } from '@domains/agent/orchestration';
