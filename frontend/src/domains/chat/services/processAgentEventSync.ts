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
  AgentChangedEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  ThinkingCompleteEvent,
  CompleteEvent,
  CitedFile,
  Message,
  ChatAttachmentSummary,
} from '@bc-agent/shared';
import { getMessageStore } from '../stores/messageStore';
import { getAgentStateStore } from '../stores/agentStateStore';
import { getApprovalStore } from '../stores/approvalStore';
import { getCitationStore } from '../stores/citationStore';
import { getChatAttachmentStore } from '../stores/chatAttachmentStore';

/**
 * Callbacks for UI state updates.
 */
export interface EventProcessorCallbacks {
  /** Called when agent busy state changes */
  onAgentBusyChange?: (busy: boolean) => void;
  /** Called on error events */
  onError?: (error: string) => void;
  /** Called when citations are received (legacy: simple map) */
  onCitationsReceived?: (citations: Map<string, string>) => void;
  /** Called when rich citations are received (new: full metadata) */
  onCitedFilesReceived?: (citedFiles: CitedFile[], messageId?: string) => void;
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
 * Events IGNORED:
 * - thinking (handled via thinking_complete instead)
 *
 * NOTE: Chunk types (thinking_chunk, message_chunk, message_partial) have been
 * removed from AgentEventType - sync architecture uses complete messages only.
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
        chatAttachmentIds?: string[];
        chatAttachments?: ChatAttachmentSummary[];
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

      // Store chat attachments - prefer full summaries over IDs-only
      // Full summaries allow immediate rendering without placeholders
      const chatAttachmentStore = getChatAttachmentStore();
      if (confirmedEvent.chatAttachments && confirmedEvent.chatAttachments.length > 0) {
        // Use full summaries (includes name, size, mimeType)
        chatAttachmentStore.getState().setMessageAttachments(
          confirmedEvent.messageId,
          confirmedEvent.chatAttachments
        );
      } else if (confirmedEvent.chatAttachmentIds && confirmedEvent.chatAttachmentIds.length > 0) {
        // Fallback to IDs-only (creates placeholders)
        chatAttachmentStore.getState().setMessageAttachmentIds(
          confirmedEvent.messageId,
          confirmedEvent.chatAttachmentIds
        );
      }
      break;
    }

    case 'thinking_complete': {
      const thinkingEvent = event as ThinkingCompleteEvent;
      // FIX: Use eventIndex as fallback when sequenceNumber is not yet available
      // This happens for async_allowed events that are emitted before persistence
      const eventWithIndex = event as { eventIndex?: number };

      // Add thinking message
      // FIX: Use eventId directly (no prefix) to match DB messageId
      messageStore.getState().addMessage({
        type: 'thinking',
        id: event.eventId,
        session_id: event.sessionId || '',
        role: 'assistant',
        content: thinkingEvent.content,
        sequence_number: event.sequenceNumber || eventWithIndex.eventIndex || 0,
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'tool_use': {
      const toolEvent = event as ToolUseEvent;
      // FIX: Use eventIndex as fallback when sequenceNumber is not yet available
      // Tool events use async_allowed persistence, so they are emitted before DB write
      const eventWithIndex = event as { eventIndex?: number };

      // FIX: Use toolUseId as message ID to match DB storage (Anthropic's toolu_* ID)
      // Fallback to eventId if toolUseId is not available (shouldn't happen in practice)
      const toolId = toolEvent.toolUseId || event.eventId;
      messageStore.getState().addMessage({
        type: 'tool_use',
        id: toolId,
        session_id: event.sessionId || '',
        role: 'assistant',
        tool_name: toolEvent.toolName,
        tool_args: toolEvent.args,
        status: 'pending',
        tool_use_id: toolId,
        sequence_number: event.sequenceNumber || eventWithIndex.eventIndex || 0,
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'tool_result': {
      const resultEvent = event as ToolResultEvent;
      const toolId = resultEvent.toolUseId;
      // FIX: Get sequence from tool_result event for completion position
      const eventWithIndex = event as { eventIndex?: number };

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

      // FIX: Update sequence_number to completion position (tool_result's seq)
      // This ensures tools appear at completion position, matching DB merge behavior
      messageStore.getState().updateMessage(toolMessage.id, {
        status: resultEvent.success ? 'success' : 'error',
        result: resultEvent.result,
        error_message: resultEvent.error,
        sequence_number: event.sequenceNumber || eventWithIndex.eventIndex || toolMessage.sequence_number,
      } as Partial<Message>);
      break;
    }

    case 'message': {
      const msgEvent = event as MessageEvent;
      // FIX: Use eventIndex as fallback when sequenceNumber is not yet available
      const eventWithIndex = event as { eventIndex?: number };

      // Add final message
      messageStore.getState().addMessage({
        type: 'standard',
        id: msgEvent.messageId,
        session_id: event.sessionId || '',
        role: msgEvent.role,
        content: msgEvent.content,
        sequence_number: event.sequenceNumber || eventWithIndex.eventIndex || 0,
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
      const citationStore = getCitationStore();
      agentStateStore.getState().setAgentBusy(false);
      agentStateStore.getState().setPaused(false);
      callbacks?.onAgentBusyChange?.(false);

      // Handle citations if present
      if (completeEvent.citedFiles && completeEvent.citedFiles.length > 0) {
        // Store rich citation info directly in citationStore
        // messageId is used to associate citations with specific messages (per PRD)
        citationStore.getState().setCitedFiles(completeEvent.citedFiles, completeEvent.messageId);

        // Callback with full CitedFile[]
        callbacks?.onCitedFilesReceived?.(completeEvent.citedFiles, completeEvent.messageId);

        // Legacy callback (backward compatibility)
        const citationMap = new Map<string, string>();
        for (const file of completeEvent.citedFiles) {
          if (file.fileId) {
            citationMap.set(file.fileName, file.fileId);
          }
        }
        callbacks?.onCitationsReceived?.(citationMap);
      } else if (completeEvent.citedFiles) {
        // Empty array clears citations
        citationStore.getState().clearCitations();
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

    // NOTE: Chunk types (thinking_chunk, message_chunk, message_partial) have been removed
    // from AgentEventType - sync architecture uses complete messages only

    case 'agent_changed': {
      const agentChangedEvent = event as AgentChangedEvent;
      agentStateStore.getState().setCurrentAgentIdentity(agentChangedEvent.currentAgent);
      break;
    }

    case 'content_refused': {
      agentStateStore.getState().setAgentBusy(false);
      callbacks?.onAgentBusyChange?.(false);
      callbacks?.onError?.((event as { reason?: string }).reason ?? 'Content refused by policy');
      break;
    }

    case 'session_end': {
      agentStateStore.getState().setAgentBusy(false);
      agentStateStore.getState().setCurrentAgentIdentity(null);
      callbacks?.onAgentBusyChange?.(false);
      break;
    }

    // Thinking event (may be emitted by some flows - ignore as we handle thinking_complete)
    case 'thinking':
      if (process.env.NODE_ENV === 'development') {
        console.debug('[ProcessAgentEventSync] Ignored thinking event (use thinking_complete):', event.type);
      }
      break;

    default:
      if (process.env.NODE_ENV === 'development') {
        console.debug('[ProcessAgentEventSync] Unknown event type:', (event as { type: string }).type);
      }
  }
}
