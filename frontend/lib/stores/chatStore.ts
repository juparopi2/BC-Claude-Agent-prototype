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
  MessageChunkEvent,
  // PHASE 4.6: Message types from shared package (single source of truth)
  Message,
  StandardMessage,
} from '@bc-agent/shared';

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
  expiresAt?: Date;
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
      set({ messages });
    },

    addMessage: (message) =>
      set((state) => ({
        messages: [...state.messages, message].sort((a, b) => {
          // Primary sort: sequence_number (if both have valid values)
          const seqA = a.sequence_number ?? 0;
          const seqB = b.sequence_number ?? 0;

          // If both have real sequence numbers (> 0), sort by them
          if (seqA > 0 && seqB > 0) {
            return seqA - seqB;
          }

          // If only one has a real sequence number, prioritize it
          if (seqA > 0) return 1;  // a goes after b
          if (seqB > 0) return -1; // b goes after a

          // Both are optimistic (sequence 0 or undefined) - sort by timestamp
          const timeA = new Date(a.created_at).getTime();
          const timeB = new Date(b.created_at).getTime();
          return timeA - timeB;
        }),
      })),

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
          messages: [...state.messages, confirmedMessage].sort((a, b) => {
            // Primary sort: sequence_number (if both have valid values)
            const seqA = a.sequence_number ?? 0;
            const seqB = b.sequence_number ?? 0;

            // If both have real sequence numbers (> 0), sort by them
            if (seqA > 0 && seqB > 0) {
              return seqA - seqB;
            }

            // If only one has a real sequence number, prioritize it
            if (seqA > 0) return 1;  // a goes after b
            if (seqB > 0) return -1; // b goes after a

            // Both are optimistic (sequence 0 or undefined) - sort by timestamp
            const timeA = new Date(a.created_at).getTime();
            const timeB = new Date(b.created_at).getTime();
            return timeA - timeB;
          }),
        };
      }),

    removeOptimisticMessage: (tempId) =>
      set((state) => {
        const newMap = new Map(state.optimisticMessages);
        newMap.delete(tempId);
        return { optimisticMessages: newMap };
      }),

    updateMessage: (messageId, updates) =>
      set((state) => ({
        messages: state.messages.map(m =>
          m.id === messageId ? ({ ...m, ...updates } as Message) : m
        ),
      })),

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
    setAgentBusy: (isAgentBusy) => set({ isAgentBusy }),
    setError: (error) => set({ error }),

    // ========================================
    // Session
    // ========================================
    setCurrentSession: (currentSessionId) => set({ currentSessionId }),

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
      const actions = get();

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

          // Also update the thinking message
          const thinkingMessage = actions.messages.find(m => m.type === 'thinking' && m.content !== undefined);
          if (thinkingMessage) {
            const updatedContent = (thinkingMessage.content || '') + (thinkingEvent.content || '');
            actions.updateMessage(thinkingMessage.id, {
              content: updatedContent,
            });
          }
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

          // Find the tool_use message and update it
          const toolMessage = actions.messages.find(
            m => m.type === 'tool_use' && m.tool_use_id === toolId
          );

          if (toolMessage) {
            actions.updateMessage(toolMessage.id, {
              status: resultEvent.success ? 'success' : 'error',
              result: resultEvent.result,
              error_message: resultEvent.error,
              duration_ms: resultEvent.durationMs,
            } as Partial<Message>);
          }
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

        case 'complete':
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
  return [...state.messages, ...optimisticArray].sort((a, b) => {
    // Primary sort: sequence_number (if both have valid values)
    const seqA = a.sequence_number ?? 0;
    const seqB = b.sequence_number ?? 0;

    // If both have real sequence numbers (> 0), sort by them
    if (seqA > 0 && seqB > 0) {
      return seqA - seqB;
    }

    // If only one has a real sequence number, prioritize it
    if (seqA > 0) return 1;  // a goes after b
    if (seqB > 0) return -1; // b goes after a

    // Both are optimistic (sequence 0 or undefined) - sort by timestamp
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return timeA - timeB;
  });
};

/**
 * Selector for pending approvals as array
 */
export const selectPendingApprovals = (state: ChatStore): PendingApproval[] => {
  return Array.from(state.pendingApprovals.values());
};
