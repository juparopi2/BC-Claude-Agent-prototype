/**
 * Unit Tests - Phase 1A: Token Tracking - Database + Logging
 *
 * Tests that DirectAgentService:
 * 1. Captures token counts from message_start and message_delta events
 * 2. Captures Anthropic message ID
 * 3. Captures model name
 * 4. Logs token data to console
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import type { AgentEvent } from '@/types/agent.types';

// Mock dependencies
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue({
      id: 'event-123',
      sequence_number: 1,
      timestamp: new Date(),
    }),
  })),
}));

vi.mock('@/services/message/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Phase 1A: Token Tracking - Database + Logging', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console.log to verify token logging
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Token Count Capture', () => {
    it('should capture input tokens from message_start event', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test response'],
        usage: {
          input_tokens: 150,
          output_tokens: 0,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test prompt',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify console.log was called with token tracking data
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TOKEN TRACKING]',
        expect.objectContaining({
          inputTokens: 150,
        })
      );
    });

    it('should capture output tokens from message_delta event', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Longer test response'],
        usage: {
          input_tokens: 100,
          output_tokens: 250,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test prompt',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify output tokens captured
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TOKEN TRACKING]',
        expect.objectContaining({
          outputTokens: 250,
        })
      );
    });

    it('should calculate total tokens correctly', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test response'],
        usage: {
          input_tokens: 200,
          output_tokens: 300,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test prompt',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify total tokens = input + output
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TOKEN TRACKING]',
        expect.objectContaining({
          inputTokens: 200,
          outputTokens: 300,
          totalTokens: 500,
        })
      );
    });
  });

  describe('Anthropic Message ID Capture', () => {
    it('should capture Anthropic message ID in correct format', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test'],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify message ID is captured (FakeAnthropicClient generates fake_msg_xxx format)
      const tokenTrackingCall = consoleLogSpy.mock.calls.find(
        (call) => call[0] === '[TOKEN TRACKING]'
      );
      expect(tokenTrackingCall).toBeDefined();
      expect(tokenTrackingCall![1].messageId).toBeDefined();
      expect(typeof tokenTrackingCall![1].messageId).toBe('string');
    });

    it('should NOT use UUID format for message ID', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test'],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify logged messageId is NOT UUID format
      const tokenTrackingCall = consoleLogSpy.mock.calls.find(
        (call) => call[0] === '[TOKEN TRACKING]'
      );
      expect(tokenTrackingCall).toBeDefined();
      const loggedData = tokenTrackingCall![1];

      // UUID regex: 8-4-4-4-12 hex digits
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(loggedData.messageId).not.toMatch(uuidRegex);
    });
  });

  describe('Model Name Capture', () => {
    it('should capture model name from message_start event', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test'],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify model name logged (FakeAnthropicClient uses request.model from env.ANTHROPIC_MODEL)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TOKEN TRACKING]',
        expect.objectContaining({
          model: expect.any(String),
        })
      );
    });
  });

  describe('Token Logging Format', () => {
    it('should log token data with correct structure', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test'],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test',
        'test-session-456',
        (event) => events.push(event),
        'test-user'
      );

      // Verify log structure includes all required fields
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TOKEN TRACKING]',
        expect.objectContaining({
          messageId: expect.any(String),
          model: expect.any(String),
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          totalTokens: expect.any(Number),
          sessionId: 'test-session-456',
          turnCount: expect.any(Number),
        })
      );
    });

    it('should log tokens immediately after stream completes', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      mockClient.addResponse({
        textBlocks: ['Test'],
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Test',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify [TOKEN TRACKING] log appears after [STREAM] logs
      const logCalls = consoleLogSpy.mock.calls;
      const streamCompletedIndex = logCalls.findIndex((call) =>
        String(call[0]).includes('[STREAM] Stream completed')
      );
      const tokenTrackingIndex = logCalls.findIndex(
        (call) => call[0] === '[TOKEN TRACKING]'
      );

      expect(streamCompletedIndex).toBeGreaterThan(-1);
      expect(tokenTrackingIndex).toBeGreaterThan(streamCompletedIndex);
    });
  });

  describe('Edge Cases', () => {
    it('should handle custom token counts correctly', async () => {
      const mockClient = new FakeAnthropicClient();
      const service = new DirectAgentService(undefined, undefined, mockClient);

      // Test with custom token values
      mockClient.addResponse({
        textBlocks: ['Custom response'],
        usage: {
          input_tokens: 50,
          output_tokens: 75,
        },
      });

      const events: AgentEvent[] = [];
      await service.executeQueryStreaming(
        'Custom prompt',
        'test-session',
        (event) => events.push(event),
        'test-user'
      );

      // Verify custom tokens logged correctly
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[TOKEN TRACKING]',
        expect.objectContaining({
          inputTokens: 50,
          outputTokens: 75,
          totalTokens: 125,
        })
      );
    });
  });
});
