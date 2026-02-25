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
export type AgentRenderedResultType =
  | 'chart_config'
  | 'citation_result'
  | 'bc_entity'
  | 'web_search_result'
  | 'web_fetch_result'
  | 'code_execution_result';

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

/**
 * Detect result type for Anthropic server tools based on toolName and result shape.
 *
 * Server tool results don't have a `_type` discriminator field, so we use
 * the tool name combined with result structure to determine the renderer type.
 *
 * @param toolName - Name of the tool that produced the result
 * @param parsedResult - Parsed result object from tool execution
 * @returns The AgentRenderedResultType if detected, null otherwise
 */
export function detectServerToolResultType(
  toolName: string | undefined,
  parsedResult: unknown
): AgentRenderedResultType | null {
  if (!toolName || !parsedResult) return null;

  switch (toolName) {
    case 'web_search':
      if (Array.isArray(parsedResult)) return 'web_search_result';
      break;
    case 'web_fetch': {
      const obj = parsedResult as Record<string, unknown>;
      if (obj.type === 'web_fetch_result') return 'web_fetch_result';
      break;
    }
    case 'bash_code_execution': {
      const obj = parsedResult as Record<string, unknown>;
      if (obj.type === 'bash_code_execution_result') return 'code_execution_result';
      break;
    }
    case 'text_editor_code_execution': {
      const obj = parsedResult as Record<string, unknown>;
      if (obj.type === 'text_editor_code_execution_result') return 'code_execution_result';
      break;
    }
  }

  return null;
}
