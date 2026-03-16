/**
 * Process Agent Event (Synchronous Mode)
 *
 * Processes agent events for synchronous (non-streaming) execution.
 * Only handles complete messages, not streaming chunks.
 *
 * Architecture: Each event type maps to a dedicated handler function.
 * The public `processAgentEventSync` dispatches via a handler map with
 * per-handler error isolation — a failing handler for one event type will
 * not crash processing of subsequent events.
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
import { isInternalTool } from '@bc-agent/shared';
import { getMessageStore } from '../stores/messageStore';
import { getAgentExecutionStore } from '../stores/agentExecutionStore';
import { getApprovalStore } from '../stores/approvalStore';
import { getMessageMetadataStore } from '../stores/messageMetadataStore';

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

// ============================================================
// Handler type
// ============================================================

type HandlerFn = (event: AgentEvent, callbacks?: EventProcessorCallbacks) => void;

// ============================================================
// Individual event handlers
// ============================================================

function handleSessionStart(event: AgentEvent, callbacks?: EventProcessorCallbacks): void {
  const store = getAgentExecutionStore();
  // Reset state for new session
  store.getState().reset();
  store.getState().setAgentBusy(true);
  // Start new workflow turn (PRD-061)
  store.getState().startTurn();
  callbacks?.onAgentBusyChange?.(true);
}

function handleUserMessageConfirmed(event: AgentEvent, callbacks?: EventProcessorCallbacks): void {
  const confirmedEvent = event as {
    eventId: string;
    messageId: string;
    content: string;
    sequenceNumber: number;
    sessionId?: string;
    chatAttachmentIds?: string[];
    chatAttachments?: ChatAttachmentSummary[];
    mentions?: import('@bc-agent/shared').FileMention[];
  };

  // Ensure agent is marked busy
  const executionStore = getAgentExecutionStore();
  const state = executionStore.getState();
  if (!state.isAgentBusy) {
    state.setAgentBusy(true);
    callbacks?.onAgentBusyChange?.(true);
  }

  const messageStore = getMessageStore();
  // Clear all optimistic messages (simpler approach)
  messageStore.getState().clearAllOptimisticMessages();

  // Add confirmed message (include mentions for inline rendering)
  messageStore.getState().addMessage({
    type: 'standard',
    id: confirmedEvent.messageId,
    session_id: event.sessionId || '',
    role: 'user',
    content: confirmedEvent.content,
    sequence_number: confirmedEvent.sequenceNumber,
    created_at: new Date().toISOString(),
    mentions: confirmedEvent.mentions,
  });

  // Store chat attachments — prefer full summaries over IDs-only.
  // Full summaries allow immediate rendering without placeholders.
  const metadataStore = getMessageMetadataStore();
  if (confirmedEvent.chatAttachments && confirmedEvent.chatAttachments.length > 0) {
    // Use full summaries (includes name, size, mimeType)
    metadataStore.getState().setMessageAttachments(confirmedEvent.messageId, confirmedEvent.chatAttachments);
  } else if (confirmedEvent.chatAttachmentIds && confirmedEvent.chatAttachmentIds.length > 0) {
    // Fallback to IDs-only (creates placeholders)
    metadataStore.getState().setMessageAttachmentIds(confirmedEvent.messageId, confirmedEvent.chatAttachmentIds);
  }
}

function handleThinkingComplete(event: AgentEvent): void {
  const thinkingEvent = event as ThinkingCompleteEvent;
  // FIX: Use eventIndex as fallback when sequenceNumber is not yet available.
  // This happens for async_allowed events that are emitted before persistence.
  const eventWithIndex = event as { eventIndex?: number };

  const executionStore = getAgentExecutionStore();
  // Attach current agent identity for per-message attribution (PRD-070)
  const thinkingAgent = executionStore.getState().currentAgentIdentity;

  // FIX: Use eventId directly (no prefix) to match DB messageId
  getMessageStore().getState().addMessage({
    type: 'thinking',
    id: event.eventId,
    session_id: event.sessionId || '',
    role: 'assistant',
    content: thinkingEvent.content,
    sequence_number: event.sequenceNumber || eventWithIndex.eventIndex || 0,
    created_at: new Date().toISOString(),
    ...(thinkingAgent && { agent_identity: thinkingAgent }),
  });

  // Track message in workflow group (PRD-061)
  executionStore.getState().addMessageToCurrentGroup(event.eventId);
}

function handleToolUse(event: AgentEvent): void {
  const toolEvent = event as ToolUseEvent;

  // Filter internal infrastructure tools (transfer_to_*, transfer_back_to_*)
  if (toolEvent.toolName && isInternalTool(toolEvent.toolName)) return;

  // FIX: Use eventIndex as fallback when sequenceNumber is not yet available.
  // Tool events use async_allowed persistence, so they are emitted before DB write.
  const eventWithIndex = event as { eventIndex?: number };

  const executionStore = getAgentExecutionStore();
  // Attach current agent identity for per-message attribution (PRD-070)
  const toolAgent = executionStore.getState().currentAgentIdentity;

  // FIX: Use toolUseId as message ID to match DB storage (Anthropic's toolu_* ID).
  // Fallback to eventId if toolUseId is not available (shouldn't happen in practice).
  const toolId = toolEvent.toolUseId || event.eventId;
  getMessageStore().getState().addMessage({
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
    ...(toolAgent && { agent_identity: toolAgent }),
  });

  // Track message in workflow group (PRD-061)
  executionStore.getState().addMessageToCurrentGroup(toolId);
}

function handleToolResult(event: AgentEvent): void {
  const resultEvent = event as ToolResultEvent;

  // Skip internal infrastructure tool results (matches tool_use filter)
  if (resultEvent.toolName && isInternalTool(resultEvent.toolName)) return;

  const toolId = resultEvent.toolUseId;
  // FIX: Get sequence from tool_result event for completion position
  const eventWithIndex = event as { eventIndex?: number };

  if (!toolId) {
    console.warn('[ProcessAgentEventSync] tool_result missing toolUseId:', resultEvent);
    return;
  }

  const messageStore = getMessageStore();
  // Find the tool_use message
  const messages = messageStore.getState().messages;
  const toolMessage = messages.find(
    m => m.type === 'tool_use' && (m as { tool_use_id?: string }).tool_use_id === toolId
  );

  if (!toolMessage) {
    console.warn('[ProcessAgentEventSync] No matching tool_use for tool_result:', { toolId });
    return;
  }

  // FIX: Update sequence_number to completion position (tool_result's seq).
  // This ensures tools appear at completion position, matching DB merge behavior.
  messageStore.getState().updateMessage(toolMessage.id, {
    status: resultEvent.success ? 'success' : 'error',
    result: resultEvent.result,
    error_message: resultEvent.error,
    sequence_number: event.sequenceNumber || eventWithIndex.eventIndex || toolMessage.sequence_number,
  } as Partial<Message>);

  // Tool result updates existing message — no need to add to workflow group again
}

function handleMessage(event: AgentEvent): void {
  const msgEvent = event as MessageEvent;

  // Filter internal messages (e.g., handoff-back confirmations)
  if ((event as { isInternal?: boolean }).isInternal) return;

  // FIX: Use eventIndex as fallback when sequenceNumber is not yet available
  const eventWithIndex = event as { eventIndex?: number };

  const executionStore = getAgentExecutionStore();
  // Attach current agent identity for per-message attribution (PRD-070)
  const msgAgent = executionStore.getState().currentAgentIdentity;

  // Add final message
  getMessageStore().getState().addMessage({
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
    ...(msgAgent && { agent_identity: msgAgent }),
  });

  // Track message in workflow group (PRD-061)
  // Mark as internal if stopReason is 'tool_use' (intermediate message, not final response)
  executionStore.getState().addMessageToCurrentGroup(msgEvent.messageId);
}

function handleComplete(event: AgentEvent, callbacks?: EventProcessorCallbacks): void {
  const completeEvent = event as CompleteEvent;
  const executionStore = getAgentExecutionStore();
  const metadataStore = getMessageMetadataStore();

  executionStore.getState().setAgentBusy(false);
  executionStore.getState().setPaused(false);
  callbacks?.onAgentBusyChange?.(false);

  // Mark last group as final and end turn (PRD-061)
  executionStore.getState().markLastGroupFinal();
  executionStore.getState().endTurn();

  // Handle citations if present
  if (completeEvent.citedFiles && completeEvent.citedFiles.length > 0) {
    // Store rich citation info directly in metadataStore.
    // messageId is used to associate citations with specific messages (per PRD).
    metadataStore.getState().setCitedFiles(completeEvent.citedFiles, completeEvent.messageId);

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
    metadataStore.getState().clearCitations();
    callbacks?.onCitationsReceived?.(new Map());
  }
}

function handleError(event: AgentEvent, callbacks?: EventProcessorCallbacks): void {
  const errorEvent = event as { error: string; code?: string; retryable?: boolean; retryAfterMs?: number };
  getAgentExecutionStore().getState().setAgentBusy(false);
  callbacks?.onAgentBusyChange?.(false);
  callbacks?.onError?.(errorEvent.error);
}

function handleTurnPaused(event: AgentEvent): void {
  const pauseEvent = event as { reason?: string };
  getAgentExecutionStore().getState().setPaused(true, pauseEvent.reason);
}

function handleApprovalRequested(event: AgentEvent): void {
  const approvalEvent = event as ApprovalRequestedEvent;
  getApprovalStore().getState().addPendingApproval({
    id: approvalEvent.approvalId,
    toolName: approvalEvent.toolName,
    args: approvalEvent.args,
    changeSummary: approvalEvent.changeSummary,
    priority: approvalEvent.priority,
    expiresAt: approvalEvent.expiresAt,
    createdAt: new Date(),
  });
}

function handleApprovalResolved(event: AgentEvent): void {
  const resolvedEvent = event as { approvalId: string };
  getApprovalStore().getState().removePendingApproval(resolvedEvent.approvalId);
}

function handleAgentChanged(event: AgentEvent): void {
  const agentChangedEvent = event as AgentChangedEvent;
  const store = getAgentExecutionStore();
  // Both operations on same store — no cross-store coordination needed
  store.getState().setCurrentAgentIdentity(agentChangedEvent.currentAgent);

  // Create new workflow group for the new agent (PRD-061)
  store.getState().addGroup(agentChangedEvent.currentAgent, {
    fromAgent: agentChangedEvent.previousAgent,
    handoffType: agentChangedEvent.handoffType ?? 'supervisor_routing',
    reason: agentChangedEvent.reason,
  });
}

function handleContentRefused(event: AgentEvent, callbacks?: EventProcessorCallbacks): void {
  getAgentExecutionStore().getState().setAgentBusy(false);
  callbacks?.onAgentBusyChange?.(false);
  callbacks?.onError?.((event as { reason?: string }).reason ?? 'Content refused by policy');
}

function handleSessionEnd(event: AgentEvent, callbacks?: EventProcessorCallbacks): void {
  const store = getAgentExecutionStore();
  store.getState().setAgentBusy(false);
  store.getState().setCurrentAgentIdentity(null);
  callbacks?.onAgentBusyChange?.(false);

  // End workflow turn (PRD-061)
  store.getState().endTurn();
}

// ============================================================
// Handler map
// ============================================================

const handlerMap = new Map<string, HandlerFn>([
  ['session_start', handleSessionStart],
  ['user_message_confirmed', handleUserMessageConfirmed],
  ['thinking_complete', handleThinkingComplete],
  ['tool_use', handleToolUse],
  ['tool_result', handleToolResult],
  ['message', handleMessage],
  ['complete', handleComplete],
  ['error', handleError],
  ['turn_paused', handleTurnPaused],
  ['approval_requested', handleApprovalRequested],
  ['approval_resolved', handleApprovalResolved],
  ['agent_changed', handleAgentChanged],
  ['content_refused', handleContentRefused],
  ['session_end', handleSessionEnd],
]);

// ============================================================
// Public API
// ============================================================

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
 * - complete: Set not busy, handle citations
 * - error: Set not busy, show error
 * - turn_paused: Set paused state
 * - approval_requested: Add to approval store
 * - approval_resolved: Remove from approval store
 * - agent_changed: Update agent identity and workflow group
 * - content_refused: Set not busy, show error
 * - session_end: Reset agent identity, end turn
 *
 * Events IGNORED:
 * - thinking (handled via thinking_complete instead)
 *
 * NOTE: Chunk types (thinking_chunk, message_chunk, message_partial) have been
 * removed from AgentEventType - sync architecture uses complete messages only.
 *
 * Each handler runs inside a try/catch for error isolation: a failing handler
 * will not prevent subsequent events from being processed.
 *
 * @param event - The agent event to process
 * @param callbacks - Optional callbacks for UI state updates
 */
export function processAgentEventSync(
  event: AgentEvent,
  callbacks?: EventProcessorCallbacks
): void {
  const handler = handlerMap.get(event.type);
  if (handler) {
    try {
      handler(event, callbacks);
    } catch (error) {
      console.error(`[ProcessAgentEventSync] Handler failed for ${event.type}:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  } else if (event.type !== 'thinking') {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[ProcessAgentEventSync] Unknown event type:', event.type);
    }
  }
}
