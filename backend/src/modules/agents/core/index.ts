/**
 * Agents Core Module
 *
 * Re-exports from registry, definitions, and existing AgentFactory.
 *
 * @module modules/agents/core
 */

// Registry
export {
  AgentRegistry,
  getAgentRegistry,
  resetAgentRegistry,
  registerAgents,
} from './registry';
export type {
  AgentDefinition,
  AgentToolConfig,
  AgentWithTools,
  SupervisorAgentInfo,
} from './registry';

// Definitions
export {
  bcAgentDefinition,
  ragAgentDefinition,
  supervisorDefinition,
} from './definitions';

// Existing AgentFactory
export { type IAgentNode, BaseAgent } from './AgentFactory';
