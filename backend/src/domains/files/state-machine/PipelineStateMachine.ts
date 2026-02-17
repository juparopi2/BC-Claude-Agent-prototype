/**
 * PipelineStateMachine (PRD-01)
 *
 * Backend wrapper around the shared pure transition functions.
 * Adds structured logging for observability.
 *
 * @module domains/files/state-machine
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  canTransition,
  getTransitionErrorMessage,
  getValidTransitions,
  PipelineTransitionError,
  type PipelineStatus,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'PipelineStateMachine' });

/**
 * Stateless singleton that validates pipeline state transitions
 * with structured logging.
 */
export class PipelineStateMachine {
  /**
   * Validate a transition and throw if invalid.
   *
   * @param from - Current pipeline status
   * @param to - Desired target status
   * @throws {PipelineTransitionError} if the transition is not allowed
   */
  validateTransition(from: PipelineStatus, to: PipelineStatus): void {
    if (!canTransition(from, to)) {
      const validTargets = getValidTransitions(from);
      logger.warn(
        { from, to, validTargets },
        `Invalid pipeline transition attempted: ${getTransitionErrorMessage(from, to)}`,
      );
      throw new PipelineTransitionError(from, to);
    }

    logger.debug({ from, to }, 'Pipeline transition validated');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: PipelineStateMachine | undefined;

/**
 * Get the PipelineStateMachine singleton.
 */
export function getPipelineStateMachine(): PipelineStateMachine {
  if (!instance) {
    instance = new PipelineStateMachine();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetPipelineStateMachine(): void {
  instance = undefined;
}
