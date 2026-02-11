/**
 * Result Adapter
 *
 * Maps supervisor graph output to AgentState format for the event pipeline.
 * Handles identity detection, tool extraction, model extraction, and interrupt detection.
 *
 * @module modules/agents/supervisor/result-adapter
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { AgentState, ToolExecution, HandoffDetectionInfo } from '../orchestrator/state';
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
    if (!msg) continue;
    const msgType = msg._getType?.();
    if ((msgType === 'ai' || msgType === 'assistant') && msg.name && KNOWN_AGENT_IDS.has(msg.name as typeof AGENT_ID[keyof typeof AGENT_ID])) {
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

  // First pass: collect all ToolMessages by tool_call_id
  // Use _getType() instead of instanceof — @langchain/anthropic creates AIMessageChunk
  // (NOT a subclass of AIMessage), so instanceof fails for Anthropic messages.
  const toolMessageMap = new Map<string, BaseMessage>();
  for (const msg of messages) {
    if (msg._getType?.() === 'tool') {
      const toolCallId = (msg as unknown as { tool_call_id?: string }).tool_call_id;
      if (toolCallId) {
        toolMessageMap.set(toolCallId, msg);
      }
    }
  }

  // Second pass: match AI message tool_calls with ToolMessages
  for (const msg of messages) {
    const msgType = msg._getType?.();
    if (msgType !== 'ai' && msgType !== 'assistant') continue;

    const toolCalls = (msg as unknown as { tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string }> }).tool_calls;
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

  return toolExecutions;
}

/**
 * Extract the model name from the last AIMessage's response_metadata.
 */
export function extractUsedModel(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const msgType = msg._getType?.();
    if (msgType === 'ai' || msgType === 'assistant') {
      const metadata = (msg as unknown as { response_metadata?: Record<string, unknown> }).response_metadata;
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
 * Detect agent-to-agent handoffs from supervisor messages.
 *
 * Scans ToolMessages for `transfer_to_*` patterns that indicate
 * an agent used a handoff tool to delegate to another agent.
 */
export function detectHandoffs(messages: BaseMessage[]): HandoffDetectionInfo[] {
  const handoffs: HandoffDetectionInfo[] = [];
  const transferPattern = /^transfer_to_(.+)$/;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg._getType?.() !== 'tool') continue;

    const toolName = (msg as unknown as { name?: string }).name;
    if (!toolName) continue;

    const match = transferPattern.exec(toolName);
    if (!match || !match[1]) continue;

    const targetAgentId = match[1];
    if (!KNOWN_AGENT_IDS.has(targetAgentId as typeof AGENT_ID[keyof typeof AGENT_ID])) continue;

    const toAgentId = targetAgentId as typeof AGENT_ID[keyof typeof AGENT_ID];

    // Find the source agent by scanning backward for the nearest AI message with a name
    let fromIdentity = DEFAULT_AGENT_IDENTITY;
    for (let j = i - 1; j >= 0; j--) {
      const prev = messages[j];
      if (!prev) continue;
      const prevType = prev._getType?.();
      if ((prevType === 'ai' || prevType === 'assistant') && prev.name && KNOWN_AGENT_IDS.has(prev.name as typeof AGENT_ID[keyof typeof AGENT_ID])) {
        const fromId = prev.name as typeof AGENT_ID[keyof typeof AGENT_ID];
        fromIdentity = {
          agentId: fromId,
          agentName: AGENT_DISPLAY_NAME[fromId],
          agentIcon: AGENT_ICON[fromId],
          agentColor: AGENT_COLOR[fromId],
        };
        break;
      }
    }

    handoffs.push({
      fromAgent: fromIdentity,
      toAgent: {
        agentId: toAgentId,
        agentName: AGENT_DISPLAY_NAME[toAgentId],
        agentIcon: AGENT_ICON[toAgentId],
        agentColor: AGENT_COLOR[toAgentId],
      },
      handoffType: 'agent_handoff',
    });
  }

  return handoffs;
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
  const handoffs = detectHandoffs(messages);

  logger.debug({
    sessionId,
    messageCount: messages.length,
    agentId: identity.agentId,
    toolExecutionCount: toolExecutions.length,
    handoffCount: handoffs.length,
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
    handoffs,
  };
}
