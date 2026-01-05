/**
 * Batch Result Normalizer Interface
 *
 * Interface for normalizing LangGraph invoke() results into NormalizedAgentEvent[].
 * Allows for different normalization strategies and easy mocking in tests.
 *
 * @module shared/providers/interfaces/IBatchResultNormalizer
 */

import type { NormalizedAgentEvent } from '@bc-agent/shared';
import type { AgentState } from '@/modules/agents/orchestrator/state';
import type { IProviderAdapter } from './IProviderAdapter';

/**
 * Options for batch result normalization.
 */
export interface BatchNormalizerOptions {
  /** Include complete event at end of event array */
  includeComplete?: boolean;
  /** User ID (for session_start if needed) */
  userId?: string;
}

/**
 * Interface for batch result normalizers.
 *
 * ## Purpose
 * Normalizes the complete result from graph.invoke() into an ordered
 * array of canonical NormalizedAgentEvent objects.
 *
 * ## Design
 * - Provider-agnostic: Uses IProviderAdapter for provider-specific logic
 * - Order-preserving: Events maintain their original order from the graph
 * - Complete: Produces all events needed for emission and persistence
 *
 * ## Usage
 * ```typescript
 * const normalizer = getBatchResultNormalizer();
 * const adapter = new AnthropicAdapter(sessionId);
 * const events = normalizer.normalize(state, adapter, { includeComplete: true });
 *
 * for (const event of events) {
 *   await emit(event);
 *   await persist(event);
 * }
 * ```
 */
export interface IBatchResultNormalizer {
  /**
   * Normalize AgentState into ordered event array.
   *
   * Processing steps:
   * 1. Extract events from all AI messages (thinking, text, tool_use)
   * 2. Create tool_response events from state.toolExecutions
   * 3. Interleave tool_response after corresponding tool_request
   * 4. Sort by originalIndex to maintain order
   * 5. Optionally append complete event
   *
   * @param state - LangGraph AgentState from invoke()
   * @param adapter - Provider-specific adapter (Anthropic, OpenAI, etc.)
   * @param options - Normalization options
   * @returns Sorted array of normalized events ready for emission
   */
  normalize(
    state: AgentState,
    adapter: IProviderAdapter,
    options?: BatchNormalizerOptions
  ): NormalizedAgentEvent[];
}
