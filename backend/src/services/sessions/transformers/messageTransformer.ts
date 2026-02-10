/**
 * Message Transformer
 *
 * Transforms database message rows to API response format.
 * Handles different message types: standard, thinking, tool_use, tool_result.
 *
 * @module services/sessions/transformers/messageTransformer
 */

import type {
  DbMessageRow,
  MessageResponse,
  StandardMessageResponse,
  ThinkingMessageResponse,
  ToolUseMessageResponse,
  ToolResultMessageResponse,
} from '@/domains/sessions';
import { normalizeToolArgs } from '@/domains/agent/tools';
import type { AgentIdentity, AgentId } from '@bc-agent/shared';
import { AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';

/**
 * Try to parse a JSON string, return the original string if parsing fails
 */
export function tryParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Reconstruct agent identity from agent_id using shared constants.
 */
function buildAgentIdentity(agentId: string | null): AgentIdentity | undefined {
  if (!agentId) return undefined;
  const id = agentId as AgentId;
  const name = AGENT_DISPLAY_NAME[id];
  if (!name) return undefined;
  return {
    agentId: id,
    agentName: name,
    agentIcon: AGENT_ICON[id],
    agentColor: AGENT_COLOR[id],
  };
}

/**
 * Transform database message row to API response format
 *
 * Handles 4 message types:
 * - standard: Regular text messages (user or assistant)
 * - thinking: Extended thinking/reasoning messages
 * - tool_use: Tool invocation requests
 * - tool_result: Tool execution results
 *
 * @param row - Raw message row from database
 * @returns Transformed message for API response
 */
export function transformMessage(row: DbMessageRow): MessageResponse {
  // Parse metadata JSON if present
  let metadata: Record<string, unknown> = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // Ignore parse errors
    }
  }

  // Build token_usage if present (NESTED structure per shared types contract)
  const token_usage = (row.input_tokens != null && row.output_tokens != null)
    ? { input_tokens: row.input_tokens, output_tokens: row.output_tokens }
    : undefined;

  // Base fields shared by all message types
  const agentIdentity = buildAgentIdentity(row.agent_id);
  const base = {
    id: row.id,
    session_id: row.session_id,
    sequence_number: row.sequence_number ?? 0,
    created_at: row.created_at.toISOString(),
    event_id: row.event_id || undefined,
    ...(agentIdentity && { agent_identity: agentIdentity }),
  };

  // Transform based on message type
  switch (row.message_type) {
    case 'thinking': {
      // Extended thinking message
      const thinkingMessage: ThinkingMessageResponse = {
        ...base,
        type: 'thinking',
        role: 'assistant',
        content: row.content || '',
        duration_ms: metadata.duration_ms as number | undefined,
        model: row.model || undefined,
        token_usage,
      };
      return thinkingMessage;
    }

    case 'tool_use': {
      // Tool execution request message
      const toolUseMessage: ToolUseMessageResponse = {
        ...base,
        type: 'tool_use',
        role: 'assistant',
        tool_name: (metadata.tool_name as string) || '',
        tool_args: normalizeToolArgs(metadata.tool_args, metadata.tool_name as string),
        status: (metadata.status as 'pending' | 'success' | 'error') || 'pending',
        result: metadata.tool_result,
        error_message: metadata.error_message as string | undefined,
        tool_use_id: row.tool_use_id || undefined,
      };
      return toolUseMessage;
    }

    case 'tool_result': {
      // Tool execution result message
      const toolResultMessage: ToolResultMessageResponse = {
        ...base,
        type: 'tool_result',
        role: 'assistant',
        tool_name: (metadata.tool_name as string) || '',
        tool_args: normalizeToolArgs(metadata.tool_args, metadata.tool_name as string),
        success: (metadata.success as boolean) ?? true,
        // Read from content column, try JSON.parse for objects
        result: row.content ? tryParseJSON(row.content) : undefined,
        error_message: metadata.error_message as string | undefined,
        tool_use_id: row.tool_use_id || undefined,
        duration_ms: metadata.duration_ms as number | undefined,
      };
      return toolResultMessage;
    }

    case 'text':
    case 'standard':
    default: {
      // Standard text message (user or assistant)
      const standardMessage: StandardMessageResponse = {
        ...base,
        type: 'standard',
        role: row.role as 'user' | 'assistant',
        content: row.content || '',
        token_usage,
        stop_reason: row.stop_reason || undefined,
        model: row.model || undefined,
        citations: metadata.citations as StandardMessageResponse['citations'],
        citations_count: metadata.citations_count as number | undefined,
      };
      return standardMessage;
    }
  }
}
