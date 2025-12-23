/**
 * @module domains/agent/orchestration
 *
 * Orchestration domain for the agent execution system.
 * Main entry point that coordinates all agent execution phases.
 *
 * Implemented Classes:
 * - AgentOrchestrator: Main coordinator, entry point (~280 LOC)
 */

export * from './types';

export {
  AgentOrchestrator,
  getAgentOrchestrator,
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from './AgentOrchestrator';
