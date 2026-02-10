/**
 * Agent Rendered Result Types
 *
 * Types for agent-specific rendered results in tool output.
 * Used by the frontend AgentResultRenderer to detect and route
 * tool results to specialized renderers (charts, citations, etc.).
 *
 * @module @bc-agent/shared/types/agent-rendered-result
 */

/**
 * Known rendered result types.
 * Each maps to a specialized frontend renderer.
 */
export type AgentRenderedResultType = 'chart_config' | 'citation_result' | 'bc_entity';

/**
 * Base interface for agent-rendered results.
 * All specialized results must include a `_type` discriminator.
 */
export interface AgentRenderedResultBase {
  /** Discriminator for renderer routing */
  _type: string;
}

/**
 * Type guard: checks if a value is an agent-rendered result.
 *
 * @param value - Value to check
 * @returns True if value has a `_type` string property
 */
export function isAgentRenderedResult(value: unknown): value is AgentRenderedResultBase {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_type' in value &&
    typeof (value as Record<string, unknown>)._type === 'string'
  );
}
