/**
 * StreamingStore Tests
 *
 * Unit tests for the streaming store that handles real-time content accumulation.
 * Tests include Gap #6 (late chunks after complete) and Gap #10 (accumulator cleanup).
 *
 * @module __tests__/domains/chat/stores/streamingStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

// Will be implemented in streamingStore.ts
import {
  getStreamingStore,
  resetStreamingStore,
  useStreamingStore,
} from '../../../../src/domains/chat/stores/streamingStore';

describe('StreamingStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    resetStreamingStore();
  });

  // ============================================================================
  // Basic Streaming Operations
  // ============================================================================

  describe('startStreaming', () => {
    it('should initialize streaming state', () => {
      act(() => {
        getStreamingStore().getState().startStreaming('msg-123');
      });

      const state = getStreamingStore().getState();
      expect(state.isStreaming).toBe(true);
      expect(state.isComplete).toBe(false);
      expect(state.currentMessageId).toBe('msg-123');
      expect(state.accumulatedContent).toBe('');
      expect(state.accumulatedThinking).toBe('');
    });

    it('should reset previous state when starting new stream', () => {
      act(() => {
        getStreamingStore().getState().startStreaming('msg-1');
        getStreamingStore().getState().appendMessageChunk(0, 'Old content');
        getStreamingStore().getState().startStreaming('msg-2'); // New stream
      });

      const state = getStreamingStore().getState();
      expect(state.currentMessageId).toBe('msg-2');
      expect(state.accumulatedContent).toBe('');
    });
  });

  describe('appendMessageChunk', () => {
    it('should accumulate message chunks correctly', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Hello, ');
        getStreamingStore().getState().appendMessageChunk(1, 'world!');
      });

      const state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('Hello, world!');
    });

    it('should store chunks by eventIndex for potential reordering', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        // Chunks arrive out of order
        getStreamingStore().getState().appendMessageChunk(2, 'third');
        getStreamingStore().getState().appendMessageChunk(0, 'first');
        getStreamingStore().getState().appendMessageChunk(1, 'second');
      });

      const state = getStreamingStore().getState();
      expect(state.messageChunks.get(0)).toBe('first');
      expect(state.messageChunks.get(1)).toBe('second');
      expect(state.messageChunks.get(2)).toBe('third');
    });
  });

  describe('appendThinkingChunk', () => {
    it('should accumulate thinking chunks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Let me think...');
        getStreamingStore().getState().appendThinkingChunk(0, ' I need to consider');
      });

      const state = getStreamingStore().getState();
      expect(state.accumulatedThinking).toBe('Let me think... I need to consider');
    });

    it('should support multiple thinking blocks (blockIndex)', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'First thought');
        getStreamingStore().getState().appendThinkingChunk(1, 'Second thought');
        getStreamingStore().getState().appendThinkingChunk(0, ' continued');
      });

      const state = getStreamingStore().getState();
      expect(state.thinkingBlocks.get(0)).toBe('First thought continued');
      expect(state.thinkingBlocks.get(1)).toBe('Second thought');
      expect(state.thinkingBlocks.size).toBe(2);
    });

    it('should compute accumulatedThinking from all blocks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Block 0');
        getStreamingStore().getState().appendThinkingChunk(1, 'Block 1');
      });

      const state = getStreamingStore().getState();
      // accumulatedThinking should combine all blocks
      expect(state.accumulatedThinking).toContain('Block 0');
      expect(state.accumulatedThinking).toContain('Block 1');
    });
  });

  // ============================================================================
  // Gap #6 Fix: Late Chunks After Complete
  // ============================================================================

  describe('markComplete (Gap #6 Fix)', () => {
    it('should mark turn as complete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Content');
        getStreamingStore().getState().markComplete();
      });

      const state = getStreamingStore().getState();
      expect(state.isComplete).toBe(true);
      expect(state.isStreaming).toBe(false);
    });

    it('should ignore message chunks after complete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Valid');
        getStreamingStore().getState().markComplete();
        // Late chunk arrives after complete (network buffering)
        getStreamingStore().getState().appendMessageChunk(1, 'LATE CHUNK');
      });

      const state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('Valid');
      expect(state.accumulatedContent).not.toContain('LATE CHUNK');
    });

    it('should ignore thinking chunks after complete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Valid thinking');
        getStreamingStore().getState().markComplete();
        // Late thinking chunk
        getStreamingStore().getState().appendThinkingChunk(0, 'LATE THINKING');
      });

      const state = getStreamingStore().getState();
      expect(state.thinkingBlocks.get(0)).toBe('Valid thinking');
      expect(state.thinkingBlocks.get(0)).not.toContain('LATE');
    });

    it('should preserve capturedThinking when marking complete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Important thinking');
        getStreamingStore().getState().markComplete();
      });

      const state = getStreamingStore().getState();
      expect(state.capturedThinking).toBe('Important thinking');
    });
  });

  // ============================================================================
  // Gap #10 Fix: Reset Clears Accumulators
  // ============================================================================

  describe('reset (Gap #10 Fix)', () => {
    it('should clear all accumulators', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Some content');
        getStreamingStore().getState().appendThinkingChunk(0, 'Some thinking');
        getStreamingStore().getState().reset();
      });

      const state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('');
      expect(state.accumulatedThinking).toBe('');
      expect(state.messageChunks.size).toBe(0);
      expect(state.thinkingBlocks.size).toBe(0);
    });

    it('should reset isComplete flag to allow new chunks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().markComplete();
      });

      expect(getStreamingStore().getState().isComplete).toBe(true);

      act(() => {
        getStreamingStore().getState().reset();
      });

      expect(getStreamingStore().getState().isComplete).toBe(false);

      // Now chunks should be accepted again
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'New content');
      });

      expect(getStreamingStore().getState().accumulatedContent).toBe('New content');
    });

    it('should clear capturedThinking on reset', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Thinking');
        getStreamingStore().getState().markComplete(); // Captures thinking
      });

      expect(getStreamingStore().getState().capturedThinking).toBe('Thinking');

      act(() => {
        getStreamingStore().getState().reset();
      });

      expect(getStreamingStore().getState().capturedThinking).toBeNull();
    });
  });

  // ============================================================================
  // Streaming Lifecycle: Start → Chunks → Complete → Reset
  // ============================================================================

  describe('Complete Streaming Lifecycle', () => {
    it('should handle full streaming cycle correctly', () => {
      // Turn 1: User sends message, agent responds
      act(() => {
        getStreamingStore().getState().startStreaming('msg-1');
      });
      expect(getStreamingStore().getState().isStreaming).toBe(true);

      act(() => {
        getStreamingStore().getState().appendThinkingChunk(0, 'Let me think...');
        getStreamingStore().getState().appendMessageChunk(0, 'Hello ');
        getStreamingStore().getState().appendMessageChunk(1, 'World');
      });

      let state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('Hello World');
      expect(state.accumulatedThinking).toBe('Let me think...');

      act(() => {
        getStreamingStore().getState().markComplete();
      });

      state = getStreamingStore().getState();
      expect(state.isComplete).toBe(true);
      expect(state.capturedThinking).toBe('Let me think...');

      // Turn 2: Reset and start new message
      act(() => {
        getStreamingStore().getState().reset();
        getStreamingStore().getState().startStreaming('msg-2');
      });

      state = getStreamingStore().getState();
      expect(state.isStreaming).toBe(true);
      expect(state.isComplete).toBe(false);
      expect(state.accumulatedContent).toBe('');
      expect(state.capturedThinking).toBeNull();

      act(() => {
        getStreamingStore().getState().appendMessageChunk(0, 'New message');
        getStreamingStore().getState().markComplete();
      });

      state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('New message');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle null/undefined content gracefully', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        // @ts-expect-error - Testing runtime behavior
        getStreamingStore().getState().appendMessageChunk(0, null);
        // @ts-expect-error - Testing runtime behavior
        getStreamingStore().getState().appendThinkingChunk(0, undefined);
      });

      const state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('');
      expect(state.accumulatedThinking).toBe('');
    });

    it('should handle empty string chunks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, '');
        getStreamingStore().getState().appendMessageChunk(1, 'actual content');
        getStreamingStore().getState().appendMessageChunk(2, '');
      });

      const state = getStreamingStore().getState();
      expect(state.accumulatedContent).toBe('actual content');
    });

    it('should work without calling startStreaming first', () => {
      // Components might receive chunks before startStreaming is called
      act(() => {
        getStreamingStore().getState().appendMessageChunk(0, 'Content');
      });

      const state = getStreamingStore().getState();
      // Should still accumulate (auto-start implied)
      expect(state.accumulatedContent).toBe('Content');
    });
  });

  // ============================================================================
  // Gap #7: Pause State
  // ============================================================================

  describe('setPaused (Gap #7)', () => {
    it('should set paused state to true with reason', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().setPaused(true, 'User requested pause');
      });

      const state = getStreamingStore().getState();
      expect(state.isPaused).toBe(true);
      expect(state.pauseReason).toBe('User requested pause');
      expect(state.isStreaming).toBe(false); // Stops streaming when paused
    });

    it('should set paused state without reason', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().setPaused(true);
      });

      const state = getStreamingStore().getState();
      expect(state.isPaused).toBe(true);
      expect(state.pauseReason).toBeNull();
    });

    it('should clear paused state when resumed', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().setPaused(true, 'Paused');
        getStreamingStore().getState().setPaused(false);
      });

      const state = getStreamingStore().getState();
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
      expect(state.isStreaming).toBe(true); // Resumes streaming
    });

    it('should clear pause state on markComplete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().setPaused(true, 'Paused for reason');
        getStreamingStore().getState().markComplete();
      });

      const state = getStreamingStore().getState();
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
    });

    it('should clear pause state on reset', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().setPaused(true, 'Paused');
        getStreamingStore().getState().reset();
      });

      const state = getStreamingStore().getState();
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
    });

    it('should start with isPaused false', () => {
      const state = getStreamingStore().getState();
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
    });
  });
});
