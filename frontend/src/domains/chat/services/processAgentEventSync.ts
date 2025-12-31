/**
 * Process Agent Event (Synchronous Mode)
 *
 * Processes agent events for synchronous (non-streaming) execution.
 * Only handles complete messages, not streaming chunks.
 *
 * @module domains/chat/services/processAgentEventSync
 */

import type {
  AgentEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  ThinkingCompleteEvent,
  CompleteEvent,
  Message,
} from '@bc-agent/shared';
import { getMessageStore } from '../stores/messageStore';
import { getAgentStateStore } from '../stores/agentStateStore';
import { getApprovalStore } from '../stores/approvalStore';

/**
 * Callbacks for UI state updates.
 */
export interface EventProcessorCallbacks {
  /** Called when agent busy state changes */
  onAgentBusyChange?: (busy: boolean) => void;
  /** Called on error events */
  onError?: (error: string) => void;
  /** Called when citations are received */
  onCitationsReceived?: (citations: Map<string, string>) => void;
}

/**
 * Process an agent event and route to appropriate stores.
 *
 * Events handled:
 * - session_start: Reset state, set busy
 * - user_message_confirmed: Confirm optimistic message
 * - thinking_complete: Add thinking message
 * - tool_use: Add tool card
 * - tool_result: Update tool card with result
 * - message: Add complete message
 * - complete: Set not busy
 * - error: Set not busy, show error
 * - turn_paused: Set paused state
 * - approval_requested: Add to approval store
 * - approval_resolved: Remove from approval store
 *
 * Events IGNORED (not used in sync mode):
 * - thinking_chunk
 * - message_chunk
 * - message_partial
 * - thinking (legacy)
 *
 * @param event - The agent event to process
 * @param callbacks - Optional callbacks for UI state updates
 */
export function processAgentEventSync(
  event: AgentEvent,
  callbacks?: EventProcessorCallbacks
): void {
  const messageStore = getMessageStore();
  const agentStateStore = getAgentStateStore();
  const approvalStore = getApprovalStore();

  // Log event for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log('[ProcessAgentEventSync] Event received:', event.type, {
      eventId: event.eventId,
      sequenceNumber: event.sequenceNumber,
    });
  }

  switch (event.type) {
    case 'session_start': {
      // Reset state for new session
      agentStateStore.getState().reset();
      agentStateStore.getState().setAgentBusy(true);
      callbacks?.onAgentBusyChange?.(true);
      break;
    }

    case 'user_message_confirmed': {
      const confirmedEvent = event as {
        eventId: string;
        messageId: string;
        content: string;
        sequenceNumber: number;
        sessionId?: string;
      };

      // Ensure agent is marked busy
      const state = agentStateStore.getState();
      if (!state.isAgentBusy) {
        state.setAgentBusy(true);
        callbacks?.onAgentBusyChange?.(true);
      }

      // Clear all optimistic messages (simpler approach)
      messageStore.getState().clearAllOptimisticMessages();

      // Add confirmed message
      messageStore.getState().addMessage({
        type: 'standard',
        id: confirmedEvent.messageId,
        session_id: event.sessionId || '',
        role: 'user',
        content: confirmedEvent.content,
        sequence_number: confirmedEvent.sequenceNumber,
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'thinking_complete': {
      const thinkingEvent = event as ThinkingCompleteEvent;

      // Add thinking message
      messageStore.getState().addMessage({
        type: 'thinking',
        id: `thinking-${event.eventId}`,
        session_id: event.sessionId || '',
        role: 'assistant',
        content: thinkingEvent.content,
        sequence_number: event.sequenceNumber || 0,
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'tool_use': {
      const toolEvent = event as ToolUseEvent;

      messageStore.getState().addMessage({
        type: 'tool_use',
        id: toolEvent.eventId,
        session_id: event.sessionId || '',
        role: 'assistant',
        tool_name: toolEvent.toolName,
        tool_args: toolEvent.args,
        status: 'pending',
        tool_use_id: toolEvent.toolUseId,
        sequence_number: event.sequenceNumber || 0,
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'tool_result': {
      const resultEvent = event as ToolResultEvent;
      const toolId = resultEvent.toolUseId;

      if (!toolId) {
        console.warn('[ProcessAgentEventSync] tool_result missing toolUseId:', resultEvent);
        break;
      }

      // Find the tool_use message
      const messages = messageStore.getState().messages;
      const toolMessage = messages.find(
        m => m.type === 'tool_use' && (m as { tool_use_id?: string }).tool_use_id === toolId
      );

      if (!toolMessage) {
        console.warn('[ProcessAgentEventSync] No matching tool_use for tool_result:', { toolId });
        break;
      }

      messageStore.getState().updateMessage(toolMessage.id, {
        status: resultEvent.success ? 'success' : 'error',
        result: resultEvent.result,
        error_message: resultEvent.error,
      } as Partial<Message>);
      break;
    }

    case 'message': {
      const msgEvent = event as MessageEvent;

      // Add final message
      messageStore.getState().addMessage({
        type: 'standard',
        id: msgEvent.messageId,
        session_id: event.sessionId || '',
        role: msgEvent.role,
        content: msgEvent.content,
        sequence_number: event.sequenceNumber || 0,
        created_at: new Date().toISOString(),
        token_usage: msgEvent.tokenUsage ? {
          input_tokens: msgEvent.tokenUsage.inputTokens,
          output_tokens: msgEvent.tokenUsage.outputTokens,
        } : undefined,
        stop_reason: msgEvent.stopReason || undefined,
        model: msgEvent.model,
      });
      break;
    }

    case 'complete': {
      const completeEvent = event as CompleteEvent;
      agentStateStore.getState().setAgentBusy(false);
      agentStateStore.getState().setPaused(false);
      callbacks?.onAgentBusyChange?.(false);

      // Handle citations if present
      if (completeEvent.citedFiles && completeEvent.citedFiles.length > 0) {
        const citationMap = new Map<string, string>();
        for (const file of completeEvent.citedFiles) {
          citationMap.set(file.fileName, file.fileId);
        }
        callbacks?.onCitationsReceived?.(citationMap);
      } else if (completeEvent.citedFiles) {
        // Empty array clears citations
        callbacks?.onCitationsReceived?.(new Map());
      }
      break;
    }

    case 'error': {
      const errorEvent = event as { error: string; code?: string };
      agentStateStore.getState().setAgentBusy(false);
      callbacks?.onAgentBusyChange?.(false);
      callbacks?.onError?.(errorEvent.error);
      break;
    }

    case 'turn_paused': {
      const pauseEvent = event as { reason?: string };
      agentStateStore.getState().setPaused(true, pauseEvent.reason);
      break;
    }

    case 'approval_requested': {
      const approvalEvent = event as ApprovalRequestedEvent;
      approvalStore.getState().addPendingApproval({
        id: approvalEvent.approvalId,
        toolName: approvalEvent.toolName,
        args: approvalEvent.args,
        changeSummary: approvalEvent.changeSummary,
        priority: approvalEvent.priority,
        expiresAt: approvalEvent.expiresAt,
        createdAt: new Date(),
      });
      break;
    }

    case 'approval_resolved': {
      const resolvedEvent = event as { approvalId: string };
      approvalStore.getState().removePendingApproval(resolvedEvent.approvalId);
      break;
    }

    // Ignore streaming events (not used in sync mode)
    case 'thinking_chunk':
    case 'message_chunk':
    case 'message_partial':
    case 'thinking':
      if (process.env.NODE_ENV === 'development') {
        console.debug('[ProcessAgentEventSync] Ignored streaming event:', event.type);
      }
      break;

    default:
      if (process.env.NODE_ENV === 'development') {
        console.debug('[ProcessAgentEventSync] Unknown event type:', (event as { type: string }).type);
      }
  }
}
