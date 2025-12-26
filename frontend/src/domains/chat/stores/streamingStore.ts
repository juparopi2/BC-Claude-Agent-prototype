/**
 * Streaming Store
 *
 * Manages real-time streaming content accumulation.
 * Implements Gap #6 (late chunk guard) and Gap #10 (accumulator cleanup).
 *
 * @module domains/chat/stores/streamingStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export interface StreamingState {
  /** Whether actively streaming */
  isStreaming: boolean;
  /** Whether the agent is busy (processing but not necessarily streaming) */
  isAgentBusy: boolean;
  /** Whether the current turn is complete (Gap #6 fix) */
  isComplete: boolean;
  /** Whether the agent is paused (Gap #7) */
  isPaused: boolean;
  /** Reason for pause if paused (Gap #7) */
  pauseReason: string | null;
  /** Message chunks by eventIndex */
  messageChunks: Map<number, string>;
  /** Thinking blocks by blockIndex (Gap #5 prep - multi-block) */
  thinkingBlocks: Map<number, string>;
  /** Current message ID being streamed */
  currentMessageId: string | null;
  /** Accumulated content from all message chunks */
  accumulatedContent: string;
  /** Accumulated thinking from all blocks */
  accumulatedThinking: string;
  /** Captured thinking from previous turn (preserved for display) */
  capturedThinking: string | null;
}

export interface StreamingActions {
  /** Start a new streaming session */
  startStreaming: (messageId?: string) => void;
  /** Append a message chunk (Gap #6: ignored if complete) */
  appendMessageChunk: (eventIndex: number, content: string) => void;
  /** Append a thinking chunk to a block (Gap #5 prep: multi-block) */
  appendThinkingChunk: (blockIndex: number, content: string) => void;
  /** Mark the current turn as complete (Gap #6 fix) */
  markComplete: () => void;
  /** Set paused state with optional reason (Gap #7) */
  setPaused: (paused: boolean, reason?: string) => void;
  /** Set agent busy state */
  setAgentBusy: (busy: boolean) => void;
  /** Reset all accumulators (Gap #10 fix) */
  reset: () => void;
}

export type StreamingStore = StreamingState & StreamingActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: StreamingState = {
  isStreaming: false,
  isAgentBusy: false,
  isComplete: false,
  isPaused: false,
  pauseReason: null,
  messageChunks: new Map(),
  thinkingBlocks: new Map(),
  currentMessageId: null,
  accumulatedContent: '',
  accumulatedThinking: '',
  capturedThinking: null,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute accumulated content from chunks Map.
 * Preserves order by sorting keys (eventIndex).
 */
function computeAccumulatedContent(chunks: Map<number, string>): string {
  if (chunks.size === 0) return '';
  const sortedKeys = Array.from(chunks.keys()).sort((a, b) => a - b);
  return sortedKeys.map((key) => chunks.get(key) || '').join('');
}

/**
 * Compute accumulated thinking from all blocks.
 * Combines all blocks in order of blockIndex.
 */
function computeAccumulatedThinking(blocks: Map<number, string>): string {
  if (blocks.size === 0) return '';
  const sortedKeys = Array.from(blocks.keys()).sort((a, b) => a - b);
  return sortedKeys.map((key) => blocks.get(key) || '').join('');
}

// ============================================================================
// Store Factory
// ============================================================================

const createStreamingStore = () =>
  create<StreamingStore>()(
    subscribeWithSelector((set, get) => ({
      ...initialState,

      startStreaming: (messageId) =>
        set({
          isStreaming: true,
          isComplete: false,
          messageChunks: new Map(),
          thinkingBlocks: new Map(),
          currentMessageId: messageId || null,
          accumulatedContent: '',
          accumulatedThinking: '',
          capturedThinking: null,
        }),

      /**
       * Append a message chunk.
       * Gap #6 Fix: Ignores chunks if turn is already complete.
       */
      appendMessageChunk: (eventIndex, content) => {
        const state = get();

        // Gap #6: Guard against late chunks after complete
        if (state.isComplete) {
          if (process.env.NODE_ENV === 'development') {
            console.debug('[StreamingStore] Ignored late message chunk after complete');
          }
          return;
        }

        // Validate content
        if (content === null || content === undefined) {
          return;
        }

        set((state) => {
          const newChunks = new Map(state.messageChunks);
          const existing = newChunks.get(eventIndex) || '';
          newChunks.set(eventIndex, existing + content);

          return {
            messageChunks: newChunks,
            accumulatedContent: computeAccumulatedContent(newChunks),
            isStreaming: true, // Auto-start if not started
          };
        });
      },

      /**
       * Append a thinking chunk to a specific block.
       * Gap #5 Prep: Supports multiple thinking blocks via blockIndex.
       * Gap #6 Fix: Ignores chunks if turn is already complete.
       */
      appendThinkingChunk: (blockIndex, content) => {
        const state = get();

        // Gap #6: Guard against late chunks after complete
        if (state.isComplete) {
          if (process.env.NODE_ENV === 'development') {
            console.debug('[StreamingStore] Ignored late thinking chunk after complete');
          }
          return;
        }

        // Validate content
        if (content === null || content === undefined) {
          return;
        }

        set((state) => {
          const newBlocks = new Map(state.thinkingBlocks);
          const existing = newBlocks.get(blockIndex) || '';
          newBlocks.set(blockIndex, existing + content);

          return {
            thinkingBlocks: newBlocks,
            accumulatedThinking: computeAccumulatedThinking(newBlocks),
            isStreaming: true, // Auto-start if not started
          };
        });
      },

      /**
       * Mark the current turn as complete.
       * Gap #6 Fix: Sets isComplete flag to ignore late chunks.
       * Captures thinking for display in next turn.
       */
      markComplete: () =>
        set((state) => ({
          isComplete: true,
          isStreaming: false,
          isAgentBusy: false,
          isPaused: false,
          pauseReason: null,
          capturedThinking: state.accumulatedThinking || null,
        })),

      /**
       * Set paused state with optional reason.
       * Gap #7 Fix: Handles turn_paused events from backend.
       */
      setPaused: (paused, reason) =>
        set({
          isPaused: paused,
          pauseReason: reason || null,
          isStreaming: !paused, // Stop streaming when paused
        }),

      /**
       * Set agent busy state (processing but not streaming).
       */
      setAgentBusy: (busy) =>
        set({ isAgentBusy: busy }),

      /**
       * Reset all accumulators for new turn.
       * Gap #10 Fix: Ensures clean state between turns.
       */
      reset: () => set(initialState),
    }))
  );

// ============================================================================
// Singleton Instance
// ============================================================================

let store: ReturnType<typeof createStreamingStore> | null = null;

/**
 * Get the singleton streaming store instance.
 */
export function getStreamingStore() {
  if (!store) {
    store = createStreamingStore();
  }
  return store;
}

/**
 * Hook for components to access streaming store.
 */
export function useStreamingStore<T>(selector: (state: StreamingStore) => T): T {
  return getStreamingStore()(selector);
}

/**
 * Reset store for testing.
 */
export function resetStreamingStore(): void {
  if (store) {
    store.getState().reset();
  }
  store = null;
}
