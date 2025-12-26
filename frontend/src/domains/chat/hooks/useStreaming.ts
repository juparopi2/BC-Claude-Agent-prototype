/**
 * useStreaming Hook
 *
 * Provides access to streaming state for real-time content display.
 * Encapsulates streamingStore access for cleaner component code.
 *
 * @module domains/chat/hooks/useStreaming
 */

import {
  useStreamingStore,
  type StreamingStore,
} from '../stores/streamingStore';

/**
 * Return type for useStreaming hook
 */
export interface UseStreamingReturn {
  /** Whether actively streaming */
  isStreaming: boolean;
  /** Whether the current turn is complete */
  isComplete: boolean;
  /** Whether the agent is paused (Gap #7) */
  isPaused: boolean;
  /** Reason for pause if paused (Gap #7) */
  pauseReason: string | null;
  /** Accumulated message content */
  content: string;
  /** Accumulated thinking content */
  thinking: string;
  /** Thinking blocks for multi-block rendering */
  thinkingBlocks: Map<number, string>;
  /** Preserved thinking from previous turn */
  capturedThinking: string | null;
}

// Individual selectors to prevent infinite re-renders
const selectIsStreaming = (state: StreamingStore) => state.isStreaming;
const selectIsComplete = (state: StreamingStore) => state.isComplete;
const selectIsPaused = (state: StreamingStore) => state.isPaused;
const selectPauseReason = (state: StreamingStore) => state.pauseReason;
const selectContent = (state: StreamingStore) => state.accumulatedContent;
const selectThinking = (state: StreamingStore) => state.accumulatedThinking;
const selectThinkingBlocks = (state: StreamingStore) => state.thinkingBlocks;
const selectCapturedThinking = (state: StreamingStore) => state.capturedThinking;

/**
 * Hook for accessing streaming state.
 *
 * Provides accumulated content and thinking for real-time display,
 * along with streaming status flags.
 *
 * @returns Streaming state
 *
 * @example
 * ```tsx
 * function StreamingMessage() {
 *   const { isStreaming, content, thinking } = useStreaming();
 *
 *   if (!isStreaming && !content) {
 *     return null;
 *   }
 *
 *   return (
 *     <div>
 *       {thinking && <ThinkingBlock content={thinking} />}
 *       <MarkdownContent content={content} />
 *       {isStreaming && <Cursor />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useStreaming(): UseStreamingReturn {
  // Use individual selectors to avoid creating new objects on each render
  const isStreaming = useStreamingStore(selectIsStreaming);
  const isComplete = useStreamingStore(selectIsComplete);
  const isPaused = useStreamingStore(selectIsPaused);
  const pauseReason = useStreamingStore(selectPauseReason);
  const content = useStreamingStore(selectContent);
  const thinking = useStreamingStore(selectThinking);
  const thinkingBlocks = useStreamingStore(selectThinkingBlocks);
  const capturedThinking = useStreamingStore(selectCapturedThinking);

  return {
    isStreaming,
    isComplete,
    isPaused,
    pauseReason,
    content,
    thinking,
    thinkingBlocks,
    capturedThinking,
  };
}
