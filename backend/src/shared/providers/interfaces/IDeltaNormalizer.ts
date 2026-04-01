/**
 * Delta Normalizer Interface
 *
 * Interface for normalizing a delta slice of BaseMessage[] (one graph step)
 * into NormalizedAgentEvent[]. Used by the progressive delivery pipeline.
 *
 * Processes incremental message slices at each graph node boundary
 * during streaming execution.
 *
 * @module shared/providers/interfaces/IDeltaNormalizer
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { NormalizedAgentEvent } from '@bc-agent/shared';
import type { ToolExecution } from '@/modules/agents/orchestrator/state';

/**
 * A delta slice representing new messages and tool executions from one graph step.
 */
export interface DeltaSlice {
  /** New messages from this graph step (pre-sliced by caller) */
  messages: BaseMessage[];
  /** Tool executions matched to this delta's messages */
  toolExecutions: ToolExecution[];
  /** Whether this is the final step in the stream (triggers complete event when includeComplete is set) */
  isLastStep: boolean;
}

/**
 * Options for delta normalization.
 */
export interface DeltaNormalizerOptions {
  /**
   * Include a complete event at the end of the returned events.
   * Only meaningful when combined with delta.isLastStep = true.
   */
  includeComplete?: boolean;
  /** Model identifier used by the agent at this step */
  usedModel?: string | null;
}

/**
 * Normalizes a delta slice of BaseMessage[] into NormalizedAgentEvent[].
 *
 * Key design decisions:
 * - Receives only the NEW messages from this step (pre-sliced by caller)
 * - Does NOT produce a complete event unless options.includeComplete && delta.isLastStep
 * - Does NOT apply skipMessages offset (caller already slices correctly)
 * - Uses the normalizers index offset for originalIndex assignment (global ordering across deltas)
 *
 * ## Usage
 * ```typescript
 * const normalizer = getDeltaNormalizer();
 * const events = normalizer.normalizeDelta(
 *   { messages: deltaMessages, toolExecutions: [], isLastStep: false },
 *   sessionId
 * );
 * ```
 */
export interface IDeltaNormalizer {
  /**
   * Normalize a delta slice of messages from one graph step into NormalizedAgentEvent[].
   *
   * @param delta - Delta slice containing new messages, tool executions, and isLastStep flag
   * @param sessionId - Session ID for event context
   * @param options - Optional normalization options
   * @returns Array of normalized events for this delta
   */
  normalizeDelta(
    delta: DeltaSlice,
    sessionId: string,
    options?: DeltaNormalizerOptions
  ): NormalizedAgentEvent[];
}
