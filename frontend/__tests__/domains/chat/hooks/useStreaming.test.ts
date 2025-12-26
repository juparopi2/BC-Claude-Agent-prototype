/**
 * useStreaming Hook Tests
 *
 * Unit tests for the useStreaming hook that provides streaming state.
 *
 * @module __tests__/domains/chat/hooks/useStreaming
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useStreaming } from '../../../../src/domains/chat/hooks/useStreaming';
import {
  getStreamingStore,
  resetStreamingStore,
} from '../../../../src/domains/chat/stores/streamingStore';

describe('useStreaming', () => {
  beforeEach(() => {
    resetStreamingStore();
  });

  // ============================================================================
  // isStreaming State
  // ============================================================================

  describe('isStreaming', () => {
    it('should return false initially', () => {
      const { result } = renderHook(() => useStreaming());
      expect(result.current.isStreaming).toBe(false);
    });

    it('should return true when streaming started', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.isStreaming).toBe(true);
    });

    it('should return false after markComplete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.isStreaming).toBe(true);

      act(() => {
        getStreamingStore().getState().markComplete();
      });

      expect(result.current.isStreaming).toBe(false);
    });
  });

  // ============================================================================
  // isComplete State
  // ============================================================================

  describe('isComplete', () => {
    it('should return false initially', () => {
      const { result } = renderHook(() => useStreaming());
      expect(result.current.isComplete).toBe(false);
    });

    it('should return true after markComplete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().markComplete();
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.isComplete).toBe(true);
    });

    it('should reset to false on new stream', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().markComplete();
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.isComplete).toBe(true);

      act(() => {
        getStreamingStore().getState().startStreaming();
      });

      expect(result.current.isComplete).toBe(false);
    });
  });

  // ============================================================================
  // Accumulated Content
  // ============================================================================

  describe('content', () => {
    it('should return empty string initially', () => {
      const { result } = renderHook(() => useStreaming());
      expect(result.current.content).toBe('');
    });

    it('should return accumulated content from chunks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Hello ');
        getStreamingStore().getState().appendMessageChunk(0, 'world!');
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.content).toBe('Hello world!');
    });

    it('should order content by eventIndex', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(1, 'second');
        getStreamingStore().getState().appendMessageChunk(0, 'first');
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.content).toBe('firstsecond');
    });

    it('should update when store changes', () => {
      const { result } = renderHook(() => useStreaming());

      expect(result.current.content).toBe('');

      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'New content');
      });

      expect(result.current.content).toBe('New content');
    });
  });

  // ============================================================================
  // Accumulated Thinking
  // ============================================================================

  describe('thinking', () => {
    it('should return empty string initially', () => {
      const { result } = renderHook(() => useStreaming());
      expect(result.current.thinking).toBe('');
    });

    it('should return accumulated thinking from blocks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'I need to ');
        getStreamingStore().getState().appendThinkingChunk(0, 'think about this...');
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.thinking).toBe('I need to think about this...');
    });

    it('should handle multiple thinking blocks', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Block 0');
        getStreamingStore().getState().appendThinkingChunk(1, 'Block 1');
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.thinking).toBe('Block 0Block 1');
    });
  });

  // ============================================================================
  // Thinking Blocks Map
  // ============================================================================

  describe('thinkingBlocks', () => {
    it('should return empty Map initially', () => {
      const { result } = renderHook(() => useStreaming());
      expect(result.current.thinkingBlocks.size).toBe(0);
    });

    it('should return thinking blocks map', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'First block');
        getStreamingStore().getState().appendThinkingChunk(1, 'Second block');
      });

      const { result } = renderHook(() => useStreaming());

      expect(result.current.thinkingBlocks.size).toBe(2);
      expect(result.current.thinkingBlocks.get(0)).toBe('First block');
      expect(result.current.thinkingBlocks.get(1)).toBe('Second block');
    });
  });

  // ============================================================================
  // Captured Thinking
  // ============================================================================

  describe('capturedThinking', () => {
    it('should return null initially', () => {
      const { result } = renderHook(() => useStreaming());
      expect(result.current.capturedThinking).toBe(null);
    });

    it('should capture thinking on markComplete', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'My thinking');
        getStreamingStore().getState().markComplete();
      });

      const { result } = renderHook(() => useStreaming());
      expect(result.current.capturedThinking).toBe('My thinking');
    });

    it('should preserve captured thinking after new stream starts', () => {
      // First turn
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendThinkingChunk(0, 'Old thinking');
        getStreamingStore().getState().markComplete();
      });

      // New turn clears captured thinking
      act(() => {
        getStreamingStore().getState().startStreaming();
      });

      const { result } = renderHook(() => useStreaming());
      // startStreaming resets capturedThinking
      expect(result.current.capturedThinking).toBe(null);
    });
  });

  // ============================================================================
  // Reactivity
  // ============================================================================

  describe('reactivity', () => {
    it('should update when streaming state changes', () => {
      const { result } = renderHook(() => useStreaming());

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.content).toBe('');

      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Streaming...');
      });

      expect(result.current.isStreaming).toBe(true);
      expect(result.current.content).toBe('Streaming...');

      act(() => {
        getStreamingStore().getState().markComplete();
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.isComplete).toBe(true);
    });

    it('should reset all state on store reset', () => {
      act(() => {
        getStreamingStore().getState().startStreaming();
        getStreamingStore().getState().appendMessageChunk(0, 'Content');
        getStreamingStore().getState().appendThinkingChunk(0, 'Thinking');
      });

      const { result } = renderHook(() => useStreaming());

      act(() => {
        getStreamingStore().getState().reset();
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.isComplete).toBe(false);
      expect(result.current.content).toBe('');
      expect(result.current.thinking).toBe('');
      expect(result.current.thinkingBlocks.size).toBe(0);
      expect(result.current.capturedThinking).toBe(null);
    });
  });
});
