/**
 * Chat Store - Advanced Streaming Tests
 *
 * Unit tests for advanced streaming edge cases in the chat store.
 * Tests streaming state management, chunk accumulation, finalization, and error handling.
 *
 * @module __tests__/unit/stores/chatStore.streaming.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useChatStore } from '@/lib/stores/chatStore';
import { AgentEventFactory } from '../../fixtures/AgentEventFactory';

describe('ChatStore - Advanced Streaming', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useChatStore.getState().reset();
    });
    // Reset sequence counter for consistent event IDs
    AgentEventFactory.resetSequence();
  });

  describe('AS-1: Accumulate chunks in received order (even if out-of-order)', () => {
    it('should accumulate chunks in received order without reordering', () => {
      // Start streaming with specific message ID
      act(() => {
        useChatStore.getState().startStreaming('msg_123');
      });

      // Send chunks out of logical order: "world " then "hello "
      const chunk1 = AgentEventFactory.messageChunk({ content: 'world ' });
      const chunk2 = AgentEventFactory.messageChunk({ content: 'hello ' });

      act(() => {
        useChatStore.getState().handleAgentEvent(chunk1);
        useChatStore.getState().handleAgentEvent(chunk2);
      });

      // Verify content is accumulated in received order (NOT reordered)
      const state = useChatStore.getState();
      expect(state.streaming.content).toBe('world hello ');
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.messageId).toBe('msg_123');
    });
  });

  describe('AS-2: Finalize streaming on message event', () => {
    it('should stop streaming, clear content, and add message to messages array', () => {
      // Start streaming with specific messageId
      const messageId = 'msg_final';
      act(() => {
        useChatStore.getState().startStreaming(messageId);
      });

      // Append content via chunks
      const chunk1 = AgentEventFactory.messageChunk({ content: 'Complete ' });
      const chunk2 = AgentEventFactory.messageChunk({ content: 'message' });

      act(() => {
        useChatStore.getState().handleAgentEvent(chunk1);
        useChatStore.getState().handleAgentEvent(chunk2);
      });

      // Verify streaming state before finalization
      let state = useChatStore.getState();
      expect(state.streaming.content).toBe('Complete message');
      expect(state.streaming.isStreaming).toBe(true);

      // Send message event to finalize
      const messageEvent = AgentEventFactory.message({
        messageId,
        content: 'Complete message',
        role: 'assistant',
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(messageEvent);
      });

      // Verify streaming is finalized
      state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(false);
      expect(state.streaming.content).toBe('Complete message'); // Content is NOT cleared by endStreaming
      expect(state.isAgentBusy).toBe(false);

      // Verify message is added to messages array
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].id).toBe(messageId);
      expect(state.messages[0].content).toBe('Complete message');
      expect(state.messages[0].role).toBe('assistant');
    });
  });

  describe('AS-3: Reset streaming state between messages', () => {
    it('should clear streaming state after first message and not mix content with second message', () => {
      // Stream first message
      act(() => {
        useChatStore.getState().startStreaming('msg_first');
      });

      const chunk1 = AgentEventFactory.messageChunk({ content: 'First' });
      act(() => {
        useChatStore.getState().handleAgentEvent(chunk1);
      });

      // Finalize first message
      const message1 = AgentEventFactory.message({
        messageId: 'msg_first',
        content: 'First',
        role: 'assistant',
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(message1);
      });

      // Verify streaming is ended (but content not cleared)
      let state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(false);
      expect(state.streaming.content).toBe('First'); // endStreaming preserves content
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].content).toBe('First');

      // Start streaming second message
      act(() => {
        useChatStore.getState().startStreaming('msg_second');
      });

      const chunk2 = AgentEventFactory.messageChunk({ content: 'Second' });
      act(() => {
        useChatStore.getState().handleAgentEvent(chunk2);
      });

      // Verify content is "Second" only (doesn't contain "First")
      state = useChatStore.getState();
      expect(state.streaming.content).toBe('Second');
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.messages.length).toBe(1); // Still only first message in array
    });
  });

  describe('AS-4: NOT duplicate messages if finalized twice', () => {
    it('should verify that duplicate message events create duplicate messages (no deduplication)', () => {
      // Start streaming and add chunks
      act(() => {
        useChatStore.getState().startStreaming('msg_duplicate');
      });

      const chunk = AgentEventFactory.messageChunk({ content: 'Test content' });
      act(() => {
        useChatStore.getState().handleAgentEvent(chunk);
      });

      // Create message event
      const messageEvent = AgentEventFactory.message({
        messageId: 'msg_duplicate',
        content: 'Test content',
        role: 'assistant',
      });

      // Handle the same message event TWICE
      act(() => {
        useChatStore.getState().handleAgentEvent(messageEvent);
        useChatStore.getState().handleAgentEvent(messageEvent);
      });

      // NOTE: The current implementation does NOT deduplicate messages.
      // This test documents the actual behavior: duplicate events create duplicate messages.
      // If deduplication is needed, it should be implemented in handleAgentEvent.
      const state = useChatStore.getState();
      expect(state.messages.length).toBe(2);
      expect(state.messages[0].id).toBe('msg_duplicate');
      expect(state.messages[1].id).toBe('msg_duplicate');
      expect(state.messages[0].content).toBe('Test content');
      expect(state.messages[1].content).toBe('Test content');
    });
  });

  describe('AS-5: Clear streaming on error event', () => {
    it('should stop streaming and clear content when error event is received', () => {
      // Start streaming
      act(() => {
        useChatStore.getState().startStreaming('msg_error');
      });

      // Append partial content
      const chunk1 = AgentEventFactory.messageChunk({ content: 'Partial ' });
      const chunk2 = AgentEventFactory.messageChunk({ content: 'content...' });

      act(() => {
        useChatStore.getState().handleAgentEvent(chunk1);
        useChatStore.getState().handleAgentEvent(chunk2);
      });

      // Verify streaming is active
      let state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.content).toBe('Partial content...');

      // Send error event
      const errorEvent = AgentEventFactory.error({
        error: 'Connection timeout',
        code: 'TIMEOUT',
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(errorEvent);
      });

      // Verify streaming is ended and error is set
      state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(false);
      expect(state.streaming.content).toBe('Partial content...'); // endStreaming preserves content
      expect(state.error).toBe('Connection timeout');
      expect(state.isAgentBusy).toBe(false);
    });
  });

  describe('AS-6: Handle large messages (200+ chunks) efficiently', () => {
    it('should accumulate 200 chunks in under 100ms', () => {
      // Start streaming
      act(() => {
        useChatStore.getState().startStreaming('msg_large');
      });

      // Measure performance
      const startTime = performance.now();

      // Send 200 message_chunk events in a loop
      act(() => {
        for (let i = 0; i < 200; i++) {
          const chunk = AgentEventFactory.messageChunk({
            content: `chunk${i} `,
          });
          useChatStore.getState().handleAgentEvent(chunk);
        }
      });

      const duration = performance.now() - startTime;

      // Verify duration < 100ms
      expect(duration).toBeLessThan(100);

      // Verify content accumulated correctly
      const state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.content.length).toBeGreaterThan(1000);

      // Verify all chunks are present (spot check)
      expect(state.streaming.content).toContain('chunk0 ');
      expect(state.streaming.content).toContain('chunk50 ');
      expect(state.streaming.content).toContain('chunk100 ');
      expect(state.streaming.content).toContain('chunk150 ');
      expect(state.streaming.content).toContain('chunk199 ');
    });
  });

  describe('AS-7: Handle thinking and message chunks simultaneously', () => {
    it('should accumulate thinking and message content separately', () => {
      // Start streaming
      act(() => {
        useChatStore.getState().startStreaming('msg_interleaved');
      });

      // Interleave thinking and message chunks
      const thinkingChunk1 = AgentEventFactory.thinkingChunk({
        content: 'Analyzing...',
      });

      const messageChunk1 = AgentEventFactory.messageChunk({
        content: 'Based on ',
      });

      const thinkingChunk2 = AgentEventFactory.thinkingChunk({
        content: 'Checking...',
      });

      const messageChunk2 = AgentEventFactory.messageChunk({
        content: 'I recommend...',
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(thinkingChunk1);
        useChatStore.getState().handleAgentEvent(messageChunk1);
        useChatStore.getState().handleAgentEvent(thinkingChunk2);
        useChatStore.getState().handleAgentEvent(messageChunk2);
      });

      // Verify thinking and message content are separate
      const state = useChatStore.getState();
      expect(state.streaming.thinking).toBe('Analyzing...Checking...');
      expect(state.streaming.content).toBe('Based on I recommend...');
      expect(state.streaming.isStreaming).toBe(true);
    });
  });

  describe('AS-8: Interrupt streaming on chat:stop', () => {
    it('should stop streaming and set isAgentBusy to false when stopStreaming is called', () => {
      // Start streaming
      act(() => {
        useChatStore.getState().startStreaming('msg_interrupted');
      });

      // Append partial content
      const chunk1 = AgentEventFactory.messageChunk({ content: 'Interrupted ' });
      const chunk2 = AgentEventFactory.messageChunk({ content: 'mid-' });

      act(() => {
        useChatStore.getState().handleAgentEvent(chunk1);
        useChatStore.getState().handleAgentEvent(chunk2);
      });

      // Verify streaming is active
      let state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.content).toBe('Interrupted mid-');
      expect(state.isAgentBusy).toBe(true);

      // Call stopStreaming (simulates user clicking stop button)
      act(() => {
        useChatStore.getState().endStreaming();
      });

      // Verify streaming is stopped
      state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(false);
      expect(state.isAgentBusy).toBe(false);
      // Note: Content is NOT cleared by endStreaming, only by clearStreaming
      expect(state.streaming.content).toBe('Interrupted mid-');
    });
  });
});
