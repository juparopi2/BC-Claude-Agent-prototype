/**
 * Pipeline State Machine (PRD-01)
 *
 * @module domains/files/state-machine
 */

export {
  PipelineStateMachine,
  getPipelineStateMachine,
  __resetPipelineStateMachine,
} from './PipelineStateMachine';

// Re-export shared types for convenience
export {
  PIPELINE_STATUS,
  PIPELINE_TRANSITIONS,
  canTransition,
  getValidTransitions,
  getTransitionErrorMessage,
  PipelineTransitionError,
  type PipelineStatus,
  type PipelineStatusValue,
  type TransitionResult,
} from '@bc-agent/shared';
