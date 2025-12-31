/**
 * Message Store
 *
 * Manages persisted and optimistic messages with proper sorting.
 * Implements Gap #4 fix for robust optimistic message confirmation.
 *
 * @module domains/chat/stores/messageStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Message } from '@bc-agent/shared';
import { sortMessages } from '../utils/messageSort';

// ============================================================================
// Types
// ============================================================================

/**
 * Event metadata for debugging (Gap #3: correlationId support)
 */
export interface EventMetadata {
  /** Correlation ID for linking related events */
  correlationId?: string;
  /** Parent event ID for hierarchical relationships */
  parentEventId?: string;
  /** Original event ID from backend */
  eventId?: string;
}

export interface MessageState {
  /** Persisted messages from backend */
  messages: Message[];
  /** Temporary user messages pending confirmation */
  optimisticMessages: Map<string, Message>;
  /** Event metadata by message ID (Gap #3: for debugging) */
  eventMetadata: Map<string, EventMetadata>;
}

export interface MessageActions {
  /** Load messages from API (with tool_result merging) */
  setMessages: (messages: Message[]) => void;
  /** Add a single message */
  addMessage: (message: Message) => void;
  /** Update an existing message */
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  /** Add an optimistic (pending) message */
  addOptimisticMessage: (tempId: string, message: Message) => void;
  /** Confirm an optimistic message with server data (Gap #4 fix) */
  confirmOptimisticMessage: (tempId: string, confirmedMessage: Message) => void;
  /** Remove an optimistic message */
  removeOptimisticMessage: (tempId: string) => void;
  /** Clear all optimistic messages */
  clearAllOptimisticMessages: () => void;
  /** Set event metadata for a message (Gap #3: debugging) */
  setEventMetadata: (messageId: string, metadata: EventMetadata) => void;
  /** Get event metadata for a message */
  getEventMetadata: (messageId: string) => EventMetadata | undefined;
  /** Reset to initial state */
  reset: () => void;
}

export type MessageStore = MessageState & MessageActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: MessageState = {
  messages: [],
  optimisticMessages: new Map(),
  eventMetadata: new Map(),
};

// ============================================================================
// Store Factory
// ============================================================================

const createMessageStore = () =>
  create<MessageStore>()(
    subscribeWithSelector((set, get) => ({
      ...initialState,

      setMessages: (messages) => {
        // Merge tool_result data into corresponding tool_use messages
        const toolResults = new Map<string, Message>();

        // Collect tool_result messages
        for (const msg of messages) {
          if (msg.type === 'tool_result' && 'tool_use_id' in msg && msg.tool_use_id) {
            toolResults.set(msg.tool_use_id, msg);
          }
        }

        // Merge and filter
        const mergedMessages = messages
          .filter((m) => m.type !== 'tool_result')
          .map((m) => {
            if (m.type === 'tool_use' && 'tool_use_id' in m && m.tool_use_id) {
              const result = toolResults.get(m.tool_use_id);
              if (result && result.type === 'tool_result') {
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

        set({ messages: mergedMessages.sort(sortMessages) });
      },

      addMessage: (message) =>
        set((state) => {
          // Deduplication: Skip if message with same ID already exists
          if (state.messages.some((m) => m.id === message.id)) {
            console.debug('[messageStore] Skipping duplicate message:', message.id);
            return state;
          }
          return {
            messages: [...state.messages, message].sort(sortMessages),
          };
        }),

      updateMessage: (messageId, updates) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === messageId ? ({ ...m, ...updates } as Message) : m
          ),
        })),

      addOptimisticMessage: (tempId, message) =>
        set((state) => {
          const newMap = new Map(state.optimisticMessages);
          newMap.set(tempId, message);
          return { optimisticMessages: newMap };
        }),

      /**
       * Confirm an optimistic message with server data.
       *
       * Gap #4 Fix: Uses robust matching strategy:
       * 1. Exact match by tempId (happy path)
       * 2. Fallback: Match by content + timestamp window (5 seconds)
       */
      confirmOptimisticMessage: (tempId, confirmedMessage) =>
        set((state) => {
          const newOptimistic = new Map(state.optimisticMessages);

          // Try exact tempId match first
          if (newOptimistic.has(tempId)) {
            newOptimistic.delete(tempId);
          } else {
            // Fallback: match by content + timestamp window
            const confirmedTime = new Date(confirmedMessage.created_at).getTime();
            const TIMESTAMP_WINDOW_MS = 5000; // 5 seconds

            for (const [key, msg] of newOptimistic.entries()) {
              if (
                msg.type === 'standard' &&
                confirmedMessage.type === 'standard' &&
                msg.content === confirmedMessage.content &&
                msg.role === 'user'
              ) {
                const msgTime = new Date(msg.created_at).getTime();
                const timeDiff = Math.abs(confirmedTime - msgTime);

                if (timeDiff < TIMESTAMP_WINDOW_MS) {
                  newOptimistic.delete(key);
                  break;
                }
              }
            }
          }

          return {
            optimisticMessages: newOptimistic,
            messages: [...state.messages, confirmedMessage].sort(sortMessages),
          };
        }),

      removeOptimisticMessage: (tempId) =>
        set((state) => {
          const newMap = new Map(state.optimisticMessages);
          newMap.delete(tempId);
          return { optimisticMessages: newMap };
        }),

      clearAllOptimisticMessages: () =>
        set({ optimisticMessages: new Map() }),

      /**
       * Set event metadata for a message (Gap #3: debugging).
       * Stores correlationId and other event info for dev tools.
       */
      setEventMetadata: (messageId, metadata) =>
        set((state) => {
          const newMap = new Map(state.eventMetadata);
          newMap.set(messageId, metadata);
          return { eventMetadata: newMap };
        }),

      /**
       * Get event metadata for a message.
       */
      getEventMetadata: (messageId) => get().eventMetadata.get(messageId),

      reset: () => set(initialState),
    }))
  );

// ============================================================================
// Singleton Instance
// ============================================================================

let store: ReturnType<typeof createMessageStore> | null = null;

/**
 * Get the singleton message store instance.
 */
export function getMessageStore() {
  if (!store) {
    store = createMessageStore();
  }
  return store;
}

/**
 * Hook for components to access message store.
 */
export function useMessageStore<T>(selector: (state: MessageStore) => T): T {
  return getMessageStore()(selector);
}

/**
 * Reset store for testing.
 */
export function resetMessageStore(): void {
  if (store) {
    store.getState().reset();
  }
  store = null;
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get all messages (persisted + optimistic) sorted correctly.
 */
export function getSortedMessages(state: MessageState): Message[] {
  const optimisticArray = Array.from(state.optimisticMessages.values());
  return [...state.messages, ...optimisticArray].sort(sortMessages);
}
