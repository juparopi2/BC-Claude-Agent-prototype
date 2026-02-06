/**
 * Result Adapter
 *
 * Maps supervisor graph output to AgentState format for the event pipeline.
 * Handles identity detection, tool extraction, model extraction, and interrupt detection.
 *
 * @module modules/agents/supervisor/result-adapter
 */

import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { AgentState, ToolExecution } from '../orchestrator/state';
import type { AgentIdentity } from '@bc-agent/shared';
import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
} from '@bc-agent/shared';
import { DEFAULT_AGENT_IDENTITY } from '../orchestrator/state';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ResultAdapter' });

/**
 * Known agent IDs for identity detection.
 */
const KNOWN_AGENT_IDS = new Set(Object.values(AGENT_ID));

/**
 * Detect the agent identity from the last AIMessage with a `name` field.
 * Scans messages backward to find the last agent that produced output.
 */
export function detectAgentIdentity(messages: BaseMessage[]): AgentIdentity {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg instanceof AIMessage && msg.name && KNOWN_AGENT_IDS.has(msg.name as typeof AGENT_ID[keyof typeof AGENT_ID])) {
      const agentId = msg.name as typeof AGENT_ID[keyof typeof AGENT_ID];
      return {
        agentId,
        agentName: AGENT_DISPLAY_NAME[agentId],
        agentIcon: AGENT_ICON[agentId],
        agentColor: AGENT_COLOR[agentId],
      };
    }
  }

  return DEFAULT_AGENT_IDENTITY;
}

/**
 * Extract tool executions from supervisor messages.
 * Pairs AIMessage tool_calls with their corresponding ToolMessages.
 */
export function extractToolExecutions(messages: BaseMessage[]): ToolExecution[] {
  const toolExecutions: ToolExecution[] = [];
  const toolMessageMap = new Map<string, ToolMessage>();

  // First pass: collect all ToolMessages by tool_call_id
  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      const toolCallId = msg.tool_call_id;
      if (toolCallId) {
        toolMessageMap.set(toolCallId, msg);
      }
    }
  }

  // Second pass: match AIMessage tool_calls with ToolMessages
  for (const msg of messages) {
    if (msg instanceof AIMessage) {
      const toolCalls = (msg as AIMessage & { tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string }> }).tool_calls;
      if (!toolCalls) continue;

      for (const toolCall of toolCalls) {
        const toolMsg = toolMessageMap.get(toolCall.id);
        const resultStr = toolMsg
          ? (typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content))
          : '';

        toolExecutions.push({
          toolUseId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
          result: resultStr,
          success: !resultStr.startsWith('Error'),
          ...(resultStr.startsWith('Error') ? { error: resultStr } : {}),
        });
      }
    }
  }

  return toolExecutions;
}

/**
 * Extract the model name from the last AIMessage's response_metadata.
 */
export function extractUsedModel(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg instanceof AIMessage) {
      const metadata = (msg as AIMessage & { response_metadata?: Record<string, unknown> }).response_metadata;
      if (metadata?.model) {
        return metadata.model as string;
      }
      if (metadata?.model_name) {
        return metadata.model_name as string;
      }
    }
  }
  return null;
}

/**
 * Interrupt result indicator.
 */
export interface InterruptInfo {
  isInterrupted: boolean;
  question?: string;
  options?: unknown;
}

/**
 * Adapt supervisor graph result to AgentState format.
 *
 * Bridges the gap between createSupervisor output and the existing
 * event pipeline (BatchResultNormalizer → EventSequencer → EventProcessor).
 *
 * @param result - Raw supervisor graph output
 * @param sessionId - Session ID for context
 * @param interrupt - Optional interrupt info if execution was paused
 * @returns AgentState compatible with the event pipeline
 */
export function adaptSupervisorResult(
  result: { messages: BaseMessage[] },
  sessionId: string,
  interrupt?: InterruptInfo
): AgentState {
  const messages = result.messages || [];

  const identity = detectAgentIdentity(messages);
  const toolExecutions = extractToolExecutions(messages);
  const usedModel = extractUsedModel(messages);

  logger.debug({
    sessionId,
    messageCount: messages.length,
    agentId: identity.agentId,
    toolExecutionCount: toolExecutions.length,
    usedModel,
    isInterrupted: interrupt?.isInterrupted ?? false,
  }, 'Adapted supervisor result');

  return {
    messages,
    currentAgentIdentity: identity,
    context: {
      userId: '',
      sessionId,
    },
    activeAgent: identity.agentId,
    toolExecutions,
    usedModel: usedModel ?? null,
  };
}
