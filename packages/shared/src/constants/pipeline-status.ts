/**
 * Pipeline Status Constants (PRD-01)
 *
 * Unified file processing pipeline status replacing the dual-column
 * processing_status + embedding_status model.
 *
 * State machine with well-defined transitions:
 * ```
 * registered -> uploaded -> queued -> extracting -> chunking -> embedding -> ready
 *                                                                            (terminal)
 * Any non-terminal state -> failed
 * failed -> queued (manual retry only)
 * ```
 *
 * @module @bc-agent/shared/constants/pipeline-status
 */

// ============================================================================
// PIPELINE STATUS VALUES
// ============================================================================

/**
 * Unified pipeline status for file processing (PRD-01).
 *
 * Replaces the dual-column `processing_status` + `embedding_status` model
 * with a single state machine that eliminates ambiguous states.
 */
export const PIPELINE_STATUS = {
  /** File record created in DB, blob upload not yet confirmed */
  REGISTERED: 'registered',
  /** Blob upload confirmed, waiting to be queued for processing */
  UPLOADED: 'uploaded',
  /** Enqueued for processing (in BullMQ queue) */
  QUEUED: 'queued',
  /** Text extraction / OCR in progress */
  EXTRACTING: 'extracting',
  /** Text chunking in progress */
  CHUNKING: 'chunking',
  /** Vector embedding generation in progress */
  EMBEDDING: 'embedding',
  /** All processing complete, file ready for RAG queries */
  READY: 'ready',
  /** Processing failed (check logs; manual retry moves back to QUEUED) */
  FAILED: 'failed',
} as const;

/**
 * Type derived from PIPELINE_STATUS constant values.
 */
export type PipelineStatus = (typeof PIPELINE_STATUS)[keyof typeof PIPELINE_STATUS];

/**
 * Alias for consistency with existing `ProcessingStatusValue` / `EmbeddingStatusValue` pattern.
 */
export type PipelineStatusValue = PipelineStatus;

// ============================================================================
// TRANSITION MAP
// ============================================================================

/**
 * Valid state transitions for the pipeline state machine.
 *
 * Each key is a source state; its value is an array of valid target states.
 * `ready` is terminal (no outgoing transitions).
 * `failed -> queued` is allowed for manual retry only.
 */
export const PIPELINE_TRANSITIONS: Readonly<Record<PipelineStatus, readonly PipelineStatus[]>> = {
  [PIPELINE_STATUS.REGISTERED]: [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.FAILED],
  [PIPELINE_STATUS.UPLOADED]: [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.FAILED],
  [PIPELINE_STATUS.QUEUED]: [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.FAILED],
  [PIPELINE_STATUS.EXTRACTING]: [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.FAILED],
  [PIPELINE_STATUS.CHUNKING]: [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.FAILED],
  [PIPELINE_STATUS.EMBEDDING]: [PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED],
  [PIPELINE_STATUS.READY]: [],
  [PIPELINE_STATUS.FAILED]: [PIPELINE_STATUS.QUEUED],
} as const;

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Check whether a transition from `from` to `to` is valid.
 *
 * @param from - Current pipeline status
 * @param to - Desired target status
 * @returns `true` if the transition is allowed
 */
export function canTransition(from: PipelineStatus, to: PipelineStatus): boolean {
  const targets = PIPELINE_TRANSITIONS[from];
  return targets.includes(to);
}

/**
 * Get the list of valid target states from a given state.
 *
 * @param from - Current pipeline status
 * @returns Read-only array of valid target statuses
 */
export function getValidTransitions(from: PipelineStatus): readonly PipelineStatus[] {
  return PIPELINE_TRANSITIONS[from];
}

/**
 * Build a descriptive error message for an invalid transition attempt.
 *
 * @param from - Current pipeline status
 * @param to - Attempted target status
 * @returns Human-readable error message
 */
export function getTransitionErrorMessage(from: PipelineStatus, to: PipelineStatus): string {
  const validTargets = PIPELINE_TRANSITIONS[from];
  if (validTargets.length === 0) {
    return `Cannot transition from '${from}' to '${to}': '${from}' is a terminal state with no valid transitions.`;
  }
  return `Cannot transition from '${from}' to '${to}': valid targets are [${validTargets.join(', ')}].`;
}

// ============================================================================
// TRANSITION RESULT TYPE
// ============================================================================

/**
 * Result of an attempted state transition (used by FileRepositoryV2).
 */
export interface TransitionResult {
  /** Whether the transition succeeded */
  success: boolean;

  /** The status before the transition attempt */
  previousStatus: PipelineStatus;

  /** Error message if the transition failed */
  error?: string;
}

// ============================================================================
// TRANSITION ERROR
// ============================================================================

/**
 * Error thrown when an invalid pipeline state transition is attempted.
 */
export class PipelineTransitionError extends Error {
  public readonly from: PipelineStatus;
  public readonly to: PipelineStatus;

  constructor(from: PipelineStatus, to: PipelineStatus) {
    super(getTransitionErrorMessage(from, to));
    this.name = 'PipelineTransitionError';
    this.from = from;
    this.to = to;
  }
}
