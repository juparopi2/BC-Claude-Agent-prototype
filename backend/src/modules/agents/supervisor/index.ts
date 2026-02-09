/**
 * Supervisor Module
 *
 * Barrel exports for the supervisor multi-agent orchestration module.
 *
 * @module modules/agents/supervisor
 */

export {
  initializeSupervisorGraph,
  getSupervisorGraphAdapter,
  resumeSupervisor,
  __resetSupervisorGraph,
} from './supervisor-graph';

export { buildSupervisorPrompt } from './supervisor-prompt';
export { detectSlashCommand, type SlashCommandResult } from './slash-command-router';
export { buildReactAgents, type BuiltAgent } from './agent-builders';
export {
  adaptSupervisorResult,
  detectAgentIdentity,
  extractToolExecutions,
  extractUsedModel,
  detectHandoffs,
  type InterruptInfo,
} from './result-adapter';
export { SupervisorStateAnnotation, type SupervisorState } from './supervisor-state';
