/**
 * Chat Store
 *
 * Zustand store for chat state management.
 * Handles messages, streaming, approvals, and real-time events.
 *
 * @module lib/stores/chatStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
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
  // PHASE 4.6: Message types from shared package (single source of truth)
  Message,
} from '@bc-agent/shared';
import { isThinkingMessage } from '@bc-agent/shared';
import type { CitationFileMap } from '@/lib/types/citation.types';

// ============================================================================
// Message Sorting Utility
// ============================================================================

/**
 * Extended message type for sorting that includes transient event properties.
 * Uses type intersection instead of interface extension because Message
 * may be a type alias with dynamically computed members.
 */
type SortableMessage = Message & {
  eventIndex?: number;
  blockIndex?: number;
};

/**
 * Improved message sorting algorithm
 *
 * Handles three states:
 * 1. Persisted messages (sequence_number > 0) - sorted by sequence_number
 * 2. Transient/streaming messages (no sequence_number) - sorted by blockIndex/eventIndex
 * 3. Fallback - sorted by timestamp
 *
 * @param a - First message to compare
 * @param b - Second message to compare
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
function sortMessages(a: SortableMessage, b: SortableMessage): number {
  const seqA = a.sequence_number;
  const seqB = b.sequence_number;

  // State 1: Both have valid sequence numbers (persisted) - sort by sequence
  if (seqA && seqA > 0 && seqB && seqB > 0) {
    return seqA - seqB;
  }

  // State 2: One is persisted, one isn't
  // Persisted messages should come BEFORE unpersisted (they have their final position)
  if (seqA && seqA > 0) return -1;  // a is persisted, comes first
  if (seqB && seqB > 0) return 1;   // b is persisted, comes first

  // State 3: Both are unpersisted (transient/streaming) - use blockIndex or eventIndex
  const indexA = a.blockIndex ?? a.eventIndex ?? -1;
  const indexB = b.blockIndex ?? b.eventIndex ?? -1;

  if (indexA >= 0 && indexB >= 0 && indexA !== indexB) {
    return indexA - indexB;
  }

  // Fallback: timestamp
  const timeA = new Date(a.created_at).getTime();
  const timeB = new Date(b.created_at).getTime();
  return timeA - timeB;
}

/**
 * Streaming state for real-time message display
 */
export interface StreamingState {
  /** Currently streaming message content */
  content: string;
  /** Currently streaming thinking content */
  thinking: string;
  /** Whether actively streaming */
  isStreaming: boolean;
  /** Message ID being streamed */
  messageId?: string;
  /** Captured thinking from previous turn (preserved for display) */
  capturedThinking: string | null;
}

/**
 * Pending approval request
 */
export interface PendingApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  changeSummary: string;
  priority: 'low' | 'medium' | 'high';
  /** ISO 8601 timestamp string from the event */
  expiresAt?: string;
  createdAt: Date;
}

/**
 * Chat store state
 */
export interface ChatState {
  // Messages
  messages: Message[];
  optimisticMessages: Map<string, Message>;

  // Streaming
  streaming: StreamingState;

  // Approvals
  pendingApprovals: Map<string, PendingApproval>;

  // Citations
  /** Map of fileName -> fileId from complete event citedFiles */
  citationFileMap: CitationFileMap;

  // Status
  isLoading: boolean;
  isAgentBusy: boolean;
  error: string | null;

  // Session
  currentSessionId: string | null;
}

/**
 * Chat store actions
 */
export interface ChatActions {
  // Message management
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  addOptimisticMessage: (tempId: string, message: Message) => void;
  confirmOptimisticMessage: (tempId: string, confirmedMessage: Message) => void;
  removeOptimisticMessage: (tempId: string) => void;

  // Streaming
  startStreaming: (messageId?: string) => void;
  appendStreamContent: (content: string) => void;
  appendThinkingContent: (content: string) => void;
  endStreaming: () => void;
  clearStreaming: () => void;

  // Approvals
  addPendingApproval: (approval: PendingApproval) => void;
  removePendingApproval: (approvalId: string) => void;
  clearPendingApprovals: () => void;

  // Status
  setLoading: (loading: boolean) => void;
  setAgentBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;

  // Session
  setCurrentSession: (sessionId: string | null) => void;
  clearChat: () => void;
  /** Reset store to initial state (for testing) */
  reset: () => void;

  // Event handling
  handleAgentEvent: (event: AgentEvent) => void;
}

export type ChatStore = ChatState & ChatActions;

/**
 * Initial state
 */
const initialState: ChatState = {
  messages: [],
  optimisticMessages: new Map(),
  streaming: {
    content: '',
    thinking: '',
    isStreaming: false,
    capturedThinking: null,
  },
  pendingApprovals: new Map(),
  citationFileMap: new Map(),
  isLoading: false,
  isAgentBusy: false,
  error: null,
  currentSessionId: null,
};

/**
 * Create chat store
 */
export const useChatStore = create<ChatStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ========================================
    // Message management
    // ========================================
    setMessages: (messages) => {
      // DEBUG: Log raw messages from API to trace data issues
      console.log('[ChatStore] setMessages RAW:', messages.map(m => ({
        id: m.id,
        type: m.type,
        seq: m.sequence_number,
        role: 'role' in m ? m.role : undefined,
        hasResult: m.type === 'tool_result' ? !!(m as unknown as {result?: unknown}).result : undefined,
        hasContent: m.type === 'tool_result' || m.type === 'standard'
          ? !!('content' in m && m.content)
          : undefined,
        toolUseId: 'tool_use_id' in m ? m.tool_use_id : undefined,
      })));

      // FIX: Merge tool_result data into corresponding tool_use messages
      // This ensures tools show correct status after page refresh
      const toolResults = new Map<string, Message>();

      // Collect tool_result messages
      for (const msg of messages) {
        if (msg.type === 'tool_result' && 'tool_use_id' in msg && msg.tool_use_id) {
          toolResults.set(msg.tool_use_id, msg);
        }
      }

      // Merge tool_result into tool_use and filter out tool_result messages
      const mergedMessages = messages
        .filter(m => m.type !== 'tool_result')
        .map(m => {
          if (m.type === 'tool_use' && 'tool_use_id' in m && m.tool_use_id) {
            const result = toolResults.get(m.tool_use_id);
            if (result && result.type === 'tool_result') {
              // Merge result data into tool_use message
              return {
                ...m,
                status: result.success ? 'success' : 'error',
                result: result.result,
                error_message: result.error_message,
              } as Message;
            }
          }
          return m;
        });

      console.log('[ChatStore] setMessages:', {
        original: messages.length,
        merged: mergedMessages.length,
        toolResultsFound: toolResults.size,
      });

      set({ messages: mergedMessages.sort(sortMessages) });
    },

    addMessage: (message) => {
      // DEBUG: Log message being added
      console.log('[ChatStore] addMessage:', message.type, {
        id: message.id,
        sequenceNumber: message.sequence_number,
        role: 'role' in message ? message.role : undefined,
      });
      set((state) => ({
        // FIX 3: Use improved sorting algorithm that handles transient events correctly
        messages: [...state.messages, message].sort(sortMessages),
      }));
    },

    addOptimisticMessage: (tempId, message) =>
      set((state) => {
        const newMap = new Map(state.optimisticMessages);
        newMap.set(tempId, message);
        return { optimisticMessages: newMap };
      }),

    confirmOptimisticMessage: (tempId, confirmedMessage) =>
      set((state) => {
        const newOptimistic = new Map(state.optimisticMessages);

        // FIX #4: Primero intentar eliminar por tempId
        if (newOptimistic.has(tempId)) {
          newOptimistic.delete(tempId);
        } else {
          // Si no encuentra por ID, buscar por contenido (fallback robusto)
          // Esto maneja el caso donde el tempId del frontend no coincide con el eventId del backend
          for (const [key, msg] of newOptimistic.entries()) {
            if (
              msg.type === 'standard' &&
              confirmedMessage.type === 'standard' &&
              msg.content === confirmedMessage.content &&
              msg.role === 'user'
            ) {
              newOptimistic.delete(key);
              break;
            }
          }
        }

        return {
          optimisticMessages: newOptimistic,
          // FIX 3: Use improved sorting algorithm
          messages: [...state.messages, confirmedMessage].sort(sortMessages),
        };
      }),

    removeOptimisticMessage: (tempId) =>
      set((state) => {
        const newMap = new Map(state.optimisticMessages);
        newMap.delete(tempId);
        return { optimisticMessages: newMap };
      }),

    updateMessage: (messageId, updates) => {
      // DEBUG: Log message being updated
      console.log('[ChatStore] updateMessage:', messageId, updates);
      set((state) => ({
        messages: state.messages.map(m =>
          m.id === messageId ? ({ ...m, ...updates } as Message) : m
        ),
      }));
    },

    // ========================================
    // Streaming
    // ========================================
    startStreaming: (messageId) =>
      set(() => ({
        streaming: {
          content: '',
          thinking: '',
          isStreaming: true,
          messageId,
          capturedThinking: null,
        },
        isAgentBusy: true,
      })),

    appendStreamContent: (content) =>
      set((state) => ({
        streaming: {
          ...state.streaming,
          content: state.streaming.content + content,
        },
      })),

    appendThinkingContent: (content) => {
      // Validate content before appending
      if (content === undefined || content === null) {
        return;
      }
      
      set((state) => ({
        streaming: {
          ...state.streaming,
          thinking: state.streaming.thinking + content,
        },
      }));
    },

    endStreaming: () =>
      set((state) => ({
        streaming: {
          ...state.streaming,
          isStreaming: false,
          capturedThinking: state.streaming.thinking || null,
        },
        isAgentBusy: false,
      })),

    clearStreaming: () =>
      set({
        streaming: {
          content: '',
          thinking: '',
          isStreaming: false,
          capturedThinking: null,
        },
      }),

    // ========================================
    // Approvals
    // ========================================
    addPendingApproval: (approval) =>
      set((state) => {
        const newMap = new Map(state.pendingApprovals);
        newMap.set(approval.id, approval);
        return { pendingApprovals: newMap };
      }),

    removePendingApproval: (approvalId) =>
      set((state) => {
        const newMap = new Map(state.pendingApprovals);
        newMap.delete(approvalId);
        return { pendingApprovals: newMap };
      }),

    clearPendingApprovals: () => set({ pendingApprovals: new Map() }),

    // ========================================
    // Status
    // ========================================
    setLoading: (isLoading) => set({ isLoading }),
    setAgentBusy: (isAgentBusy) => {
      set({ isAgentBusy });
    },
    setError: (error) => set({ error }),

    // ========================================
    // Session
    // ========================================
    setCurrentSession: (currentSessionId) => {
      set({ currentSessionId });
    },

    clearChat: () =>
      set({
        ...initialState,
        currentSessionId: get().currentSessionId,
      }),

    reset: () => set(initialState),

    // ========================================
    // Event handling
    // ========================================
    handleAgentEvent: (event) => {
      // DEBUG: Log all incoming events
      console.log('[ChatStore] Event received:', event.type, {
        eventId: event.eventId,
        sequenceNumber: event.sequenceNumber,
        sessionId: event.sessionId,
        eventIndex: (event as { eventIndex?: number }).eventIndex,
        blockIndex: (event as { blockIndex?: number }).blockIndex,
      });

      const actions = get();
      const state = get();

      const shouldFilter = event.sessionId && state.currentSessionId &&
                          event.sessionId !== state.currentSessionId;

      // CRITICAL: Validate event belongs to current session (prevents cross-session leakage)
      if (shouldFilter) {
        return;
      }

      switch (event.type) {
        case 'session_start':
          actions.clearStreaming();
          actions.setAgentBusy(true);
          break;

        case 'thinking': {
          const thinkingEvent = event;

          // Create a thinking message with sequence_number
          actions.addMessage({
            type: 'thinking',
            id: thinkingEvent.eventId,
            session_id: event.sessionId || '',
            role: 'assistant',
            content: '', // Will be filled by thinking_chunks
            sequence_number: event.sequenceNumber || 0,
            created_at: new Date().toISOString(),
          });

          // Start streaming for thinking_chunks
          if (!actions.streaming.isStreaming) {
            actions.startStreaming();
          }
          break;
        }

        case 'thinking_chunk': {
          const thinkingEvent = event as ThinkingChunkEvent;
          if (!actions.streaming.isStreaming) {
            actions.startStreaming();
          }

          // Accumulate in streaming state for real-time display
          actions.appendThinkingContent(thinkingEvent.content);

          // Also update the thinking message using type guard
          const thinkingMessage = actions.messages.find(isThinkingMessage);
          if (thinkingMessage) {
            const updatedContent = thinkingMessage.content + (thinkingEvent.content || '');
            actions.updateMessage(thinkingMessage.id, {
              content: updatedContent,
            });
          }
          break;
        }

        case 'thinking_complete': {
          // Thinking block is finalized - mark it complete before text starts
          // This ensures thinking appears at the beginning, not the end
          const thinkingCompleteEvent = event as ThinkingCompleteEvent;

          // Clear streaming thinking content (it's now finalized in the message)
          set((state) => ({
            streaming: {
              ...state.streaming,
              thinkingContent: '', // Clear streaming accumulator
            },
          }));

          // Update the thinking message with final content and mark complete
          const thinkingMsg = actions.messages.find(isThinkingMessage);
          if (thinkingMsg) {
            actions.updateMessage(thinkingMsg.id, {
              content: thinkingCompleteEvent.content,
            });
          }

          console.log('[ChatStore] Thinking block finalized', {
            contentLength: thinkingCompleteEvent.content.length,
          });
          break;
        }

        case 'message_chunk': {
          const chunkEvent = event as MessageChunkEvent;
          if (!actions.streaming.isStreaming) {
            actions.startStreaming();
          }
          actions.appendStreamContent(chunkEvent.content);
          break;
        }

        case 'message': {
          const msgEvent = event as MessageEvent;
          actions.endStreaming();
          actions.addMessage({
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

        case 'user_message_confirmed': {
          // Update optimistic message with confirmed data
          const confirmedEvent = event;
          actions.confirmOptimisticMessage(
            `optimistic-${confirmedEvent.eventId}`,
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

          // Add as a MESSAGE (not toolExecution) with sequence_number
          actions.addMessage({
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
          break;
        }

        case 'tool_result': {
          const resultEvent = event as ToolResultEvent;
          const toolId = resultEvent.toolUseId || resultEvent.correlationId;

          // FIX: Validate toolUseId before attempting to update
          if (!toolId) {
            console.warn('[ChatStore] tool_result missing toolUseId:', resultEvent);
            break;
          }

          // Find the tool_use message and update it
          const toolMessage = actions.messages.find(
            m => m.type === 'tool_use' && m.tool_use_id === toolId
          );

          if (!toolMessage) {
            console.warn('[ChatStore] No matching tool_use for tool_result:', {
              toolId,
              existingToolIds: actions.messages
                .filter(m => m.type === 'tool_use')
                .map(m => (m as { tool_use_id?: string }).tool_use_id),
            });
            break;
          }

          console.log('[ChatStore] Updating tool_use with result:', {
            toolId,
            success: resultEvent.success,
          });

          actions.updateMessage(toolMessage.id, {
            status: resultEvent.success ? 'success' : 'error',
            result: resultEvent.result,
            error_message: resultEvent.error,
            duration_ms: resultEvent.durationMs,
          } as Partial<Message>);
          break;
        }

        case 'approval_requested': {
          const approvalEvent = event as ApprovalRequestedEvent;
          actions.addPendingApproval({
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
          actions.removePendingApproval(event.approvalId);
          break;

        case 'error':
          actions.setError(event.error);
          actions.endStreaming();
          break;

        case 'complete': {
          const completeEvent = event as CompleteEvent;
          actions.endStreaming();
          actions.setAgentBusy(false);

          // Update citationFileMap from citedFiles if present
          if (completeEvent.citedFiles && completeEvent.citedFiles.length > 0) {
            const newMap: CitationFileMap = new Map();
            for (const file of completeEvent.citedFiles) {
              newMap.set(file.fileName, file.fileId);
            }
            set({ citationFileMap: newMap });
          } else if (completeEvent.citedFiles) {
            // Empty array clears the map
            set({ citationFileMap: new Map() });
          }
          // If citedFiles is undefined, keep existing map
          break;
        }

        case 'session_end':
          actions.endStreaming();
          actions.setAgentBusy(false);
          break;

        case 'turn_paused':
          // Agent paused - keep busy but stop streaming
          actions.endStreaming();
          break;

        case 'content_refused':
          actions.setError('Content was refused due to policy violation');
          actions.endStreaming();
          break;
      }
    },
  }))
);

/**
 * Selector for combined messages (persisted + optimistic)
 */
export const selectAllMessages = (state: ChatStore): Message[] => {
  const optimisticArray = Array.from(state.optimisticMessages.values());
  // FIX 3: Use improved sorting algorithm that handles transient events correctly
  return [...state.messages, ...optimisticArray].sort(sortMessages);
};

/**
 * Selector for pending approvals as array
 */
export const selectPendingApprovals = (state: ChatStore): PendingApproval[] => {
  return Array.from(state.pendingApprovals.values());
};
