/**
 * StreamProcessor
 *
 * Processes agent events and routes them to appropriate stores.
 * Centralizes event handling logic with separation of concerns.
 *
 * @module domains/chat/services/streamProcessor
 */

import type {
  AgentEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  ThinkingChunkEvent,
  ThinkingCompleteEvent,
  MessageChunkEvent,
  CompleteEvent,
  Message,
} from '@bc-agent/shared';
import { isThinkingMessage } from '@bc-agent/shared';
import { getMessageStore } from '../stores/messageStore';
import { getStreamingStore } from '../stores/streamingStore';
import { getApprovalStore } from '../stores/approvalStore';

/**
 * Callbacks for UI state that remains outside domain stores.
 * These are passed in to keep domain stores pure and UI-agnostic.
 */
export interface StreamProcessorCallbacks {
  /** Called when agent starts processing */
  onAgentBusyChange?: (busy: boolean) => void;
  /** Called on error events */
  onError?: (error: string) => void;
  /** Called when citations are received */
  onCitationsReceived?: (citations: Map<string, string>) => void;
}

/**
 * Process an agent event and route to appropriate stores.
 *
 * @param event - The agent event to process
 * @param callbacks - Optional callbacks for UI state updates
 *
 * @example
 * ```typescript
 * processAgentEvent(event, {
 *   onAgentBusyChange: (busy) => setAgentBusy(busy),
 *   onError: (error) => setError(error),
 * });
 * ```
 */
export function processAgentEvent(
  event: AgentEvent,
  callbacks?: StreamProcessorCallbacks
): void {
  const messageStore = getMessageStore();
  const streamingStore = getStreamingStore();
  const approvalStore = getApprovalStore();

  // Log event for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log('[StreamProcessor] Event received:', event.type, {
      eventId: event.eventId,
      sequenceNumber: event.sequenceNumber,
      eventIndex: (event as { eventIndex?: number }).eventIndex,
      blockIndex: (event as { blockIndex?: number }).blockIndex,
    });
  }

  switch (event.type) {
    case 'session_start': {
      // ESSENTIAL: Reset state for new session - do not remove
      // NOTE: This event may or may not be emitted by the backend.
      // The real AgentOrchestrator did NOT emit this (fixed in this sprint).
      // The FakeAgentOrchestrator (for tests) DOES emit this.
      // The guard ensures idempotent behavior if both session_start and
      // user_message_confirmed arrive (both can trigger reset).
      const sessionStreamState = streamingStore.getState();
      if (!sessionStreamState.isAgentBusy) {
        sessionStreamState.reset();
        sessionStreamState.setAgentBusy(true);
        callbacks?.onAgentBusyChange?.(true);
      }
      break;
    }

    case 'thinking': {
      /**
       * @deprecated LEGACY HANDLER - Remove after Q2 2025
       *
       * This handler exists for backwards compatibility with older backends.
       * Modern backend uses thinking_chunk + thinking_complete events instead.
       *
       * Migration plan:
       * 1. Verify backend no longer emits 'thinking' events
       * 2. Remove this case block entirely
       * 3. Update ThinkingEvent type if needed
       */
      const thinkingEvent = event;
      messageStore.getState().addMessage({
        type: 'thinking',
        id: thinkingEvent.eventId,
        session_id: event.sessionId || '',
        role: 'assistant',
        content: '',
        sequence_number: event.sequenceNumber || 0,
        created_at: new Date().toISOString(),
      });

      if (!streamingStore.getState().isStreaming) {
        streamingStore.getState().startStreaming();
      }
      break;
    }

    case 'thinking_chunk': {
      const thinkingChunkEvent = event as ThinkingChunkEvent;
      const state = streamingStore.getState();

      // Gap #6: Ignore late chunks after complete
      if (state.isComplete) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[StreamProcessor] Ignored late thinking_chunk (isComplete=true)');
        }
        break;
      }

      if (!state.isStreaming) {
        state.startStreaming();
      }

      // Append to streaming store with block index
      state.appendThinkingChunk(
        thinkingChunkEvent.blockIndex ?? 0,
        thinkingChunkEvent.content
      );

      // Also update thinking message in messageStore
      const messages = messageStore.getState().messages;
      const thinkingMessage = messages.find(isThinkingMessage);
      if (thinkingMessage) {
        const updatedContent = thinkingMessage.content + (thinkingChunkEvent.content || '');
        messageStore.getState().updateMessage(thinkingMessage.id, {
          content: updatedContent,
        });
      }
      break;
    }

    case 'thinking_complete': {
      const thinkingCompleteEvent = event as ThinkingCompleteEvent;

      // Update thinking message with final content
      const messages = messageStore.getState().messages;
      const thinkingMsg = messages.find(isThinkingMessage);
      if (thinkingMsg) {
        messageStore.getState().updateMessage(thinkingMsg.id, {
          content: thinkingCompleteEvent.content,
        });
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[StreamProcessor] Thinking block finalized', {
          contentLength: thinkingCompleteEvent.content.length,
        });
      }
      break;
    }

    case 'message_chunk': {
      const chunkEvent = event as MessageChunkEvent;
      const state = streamingStore.getState();

      // Gap #6: Ignore late chunks after complete
      if (state.isComplete) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[StreamProcessor] Ignored late message_chunk (isComplete=true)');
        }
        break;
      }

      if (!state.isStreaming) {
        state.startStreaming();
      }

      state.appendMessageChunk(
        chunkEvent.eventIndex ?? 0,
        chunkEvent.content
      );
      break;
    }

    case 'message': {
      const msgEvent = event as MessageEvent;

      // Mark streaming complete and reset
      streamingStore.getState().markComplete();

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

      // Gap #3: Store correlation metadata for debugging
      if (event.correlationId || event.parentEventId) {
        messageStore.getState().setEventMetadata(msgEvent.messageId, {
          correlationId: event.correlationId,
          parentEventId: event.parentEventId,
          eventId: event.eventId,
        });
      }
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

      // DEFENSIVE FIX: Reset streaming state for new turn
      // This handles the case where session_start is not emitted by the backend.
      // user_message_confirmed is ALWAYS the first event from the real AgentOrchestrator.
      // This reset is idempotent - if session_start already reset, this is a no-op.
      const streamState = streamingStore.getState();
      if (!streamState.isAgentBusy) {
        streamState.reset();
        streamState.setAgentBusy(true);
        callbacks?.onAgentBusyChange?.(true);
      }

      // Try both ID formats for compatibility
      const tempIdOptions = [
        `optimistic-${confirmedEvent.eventId}`,
        `optimistic-${Date.now()}`, // Fallback will use content matching
      ];

      messageStore.getState().confirmOptimisticMessage(
        tempIdOptions[0],
        {
          type: 'standard',
          id: confirmedEvent.messageId,
          session_id: event.sessionId || '',
          role: 'user',
          content: confirmedEvent.content,
          sequence_number: confirmedEvent.sequenceNumber,
          created_at: new Date().toISOString(),
        }
      );
      break;
    }

    case 'tool_use': {
      const toolEvent = event as ToolUseEvent;

      messageStore.getState().addMessage({
        type: 'tool_use' as const,
        id: toolEvent.eventId,
        session_id: event.sessionId || '',
        role: 'assistant' as const,
        tool_name: toolEvent.toolName,
        tool_args: toolEvent.args,
        status: 'pending',
        tool_use_id: toolEvent.toolUseId,
        sequence_number: event.sequenceNumber || 0,
        created_at: new Date().toISOString(),
      });

      // Gap #3: Store correlation metadata for debugging
      if (event.correlationId || event.parentEventId) {
        messageStore.getState().setEventMetadata(toolEvent.eventId, {
          correlationId: event.correlationId,
          parentEventId: event.parentEventId,
          eventId: event.eventId,
        });
      }
      break;
    }

    case 'tool_result': {
      const resultEvent = event as ToolResultEvent;
      const toolId = resultEvent.toolUseId || resultEvent.correlationId;

      if (!toolId) {
        console.warn('[StreamProcessor] tool_result missing toolUseId:', resultEvent);
        break;
      }

      // Find the tool_use message
      const messages = messageStore.getState().messages;
      const toolMessage = messages.find(
        m => m.type === 'tool_use' && (m as { tool_use_id?: string }).tool_use_id === toolId
      );

      if (!toolMessage) {
        console.warn('[StreamProcessor] No matching tool_use for tool_result:', {
          toolId,
          existingToolIds: messages
            .filter(m => m.type === 'tool_use')
            .map(m => (m as { tool_use_id?: string }).tool_use_id),
        });
        break;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[StreamProcessor] Updating tool_use with result:', {
          toolId,
          success: resultEvent.success,
        });
      }

      messageStore.getState().updateMessage(toolMessage.id, {
        status: resultEvent.success ? 'success' : 'error',
        result: resultEvent.result,
        error_message: resultEvent.error,
        duration_ms: resultEvent.durationMs,
      } as Partial<Message>);
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

    case 'approval_resolved':
      approvalStore.getState().removePendingApproval(
        (event as { approvalId: string }).approvalId
      );
      break;

    case 'error':
      streamingStore.getState().markComplete();
      streamingStore.getState().setAgentBusy(false);
      callbacks?.onError?.((event as { error: string }).error);
      break;

    case 'turn_paused': {
      // Gap #7: Handle turn_paused event
      const pausedEvent = event as {
        content?: string;
        messageId?: string;
        reason?: string;
      };

      // Set paused state with reason
      streamingStore.getState().setPaused(true, pausedEvent.reason);

      // If there's partial content, add it as a message
      if (pausedEvent.content && pausedEvent.messageId) {
        messageStore.getState().addMessage({
          type: 'standard',
          id: pausedEvent.messageId,
          session_id: event.sessionId || '',
          role: 'assistant',
          content: pausedEvent.content,
          sequence_number: event.sequenceNumber || 0,
          created_at: new Date().toISOString(),
        });
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[StreamProcessor] Turn paused:', {
          reason: pausedEvent.reason,
          hasContent: !!pausedEvent.content,
        });
      }
      break;
    }

    case 'complete': {
      const completeEvent = event as CompleteEvent;
      streamingStore.getState().markComplete();
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

    default:
      if (process.env.NODE_ENV === 'development') {
        console.debug('[StreamProcessor] Unhandled event type:', event.type);
      }
  }
}

/**
 * Reset all stores to initial state.
 * Useful for testing or session cleanup.
 */
export function resetAllStores(): void {
  getMessageStore().getState().reset();
  getStreamingStore().getState().reset();
  getApprovalStore().getState().reset();
}
