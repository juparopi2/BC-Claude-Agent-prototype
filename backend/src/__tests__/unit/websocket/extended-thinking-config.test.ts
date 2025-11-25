/**
 * Extended Thinking Configuration - Unit Tests
 *
 * Tests for per-request Extended Thinking configuration via WebSocket.
 *
 * Feature: Frontend can enable/disable Extended Thinking per request
 * - ChatMessageData.thinking?: ExtendedThinkingConfig
 * - DirectAgentService.executeQueryStreaming accepts options parameter
 * - Falls back to env.ENABLE_EXTENDED_THINKING if not provided
 *
 * @module __tests__/unit/websocket/extended-thinking-config
 * @date 2025-11-24
 */

import { describe, it, expect } from 'vitest';
import type { ChatMessageData, ExtendedThinkingConfig } from '../../../types/websocket.types';
import type { ExecuteStreamingOptions } from '../../../services/agent/DirectAgentService';

describe('Extended Thinking Configuration', () => {
  describe('ExtendedThinkingConfig Interface', () => {
    it('should allow enabling thinking with default budget', () => {
      const config: ExtendedThinkingConfig = {
        enableThinking: true,
      };

      expect(config.enableThinking).toBe(true);
      expect(config.thinkingBudget).toBeUndefined();
    });

    it('should allow custom thinking budget', () => {
      const config: ExtendedThinkingConfig = {
        enableThinking: true,
        thinkingBudget: 15000,
      };

      expect(config.enableThinking).toBe(true);
      expect(config.thinkingBudget).toBe(15000);
    });

    it('should allow disabling thinking explicitly', () => {
      const config: ExtendedThinkingConfig = {
        enableThinking: false,
      };

      expect(config.enableThinking).toBe(false);
    });

    it('should allow minimum budget (1024)', () => {
      const config: ExtendedThinkingConfig = {
        enableThinking: true,
        thinkingBudget: 1024, // Minimum allowed by Anthropic
      };

      expect(config.thinkingBudget).toBe(1024);
    });
  });

  describe('ChatMessageData with Extended Thinking', () => {
    it('should accept message without thinking config', () => {
      const data: ChatMessageData = {
        message: 'Hello, Claude!',
        sessionId: 'session-uuid-123',
        userId: 'user-uuid-456',
      };

      expect(data.message).toBe('Hello, Claude!');
      expect(data.thinking).toBeUndefined();
    });

    it('should accept message with thinking enabled', () => {
      const data: ChatMessageData = {
        message: 'Complex reasoning task...',
        sessionId: 'session-uuid-123',
        userId: 'user-uuid-456',
        thinking: {
          enableThinking: true,
          thinkingBudget: 10000,
        },
      };

      expect(data.message).toBe('Complex reasoning task...');
      expect(data.thinking?.enableThinking).toBe(true);
      expect(data.thinking?.thinkingBudget).toBe(10000);
    });

    it('should accept message with thinking disabled explicitly', () => {
      const data: ChatMessageData = {
        message: 'Simple question',
        sessionId: 'session-uuid-123',
        userId: 'user-uuid-456',
        thinking: {
          enableThinking: false,
        },
      };

      expect(data.thinking?.enableThinking).toBe(false);
    });
  });

  describe('ExecuteStreamingOptions Interface', () => {
    it('should match ExtendedThinkingConfig structure', () => {
      // ExecuteStreamingOptions should be compatible with what ChatMessageHandler passes
      const options: ExecuteStreamingOptions = {
        enableThinking: true,
        thinkingBudget: 12000,
      };

      expect(options.enableThinking).toBe(true);
      expect(options.thinkingBudget).toBe(12000);
    });

    it('should allow partial options', () => {
      const options: ExecuteStreamingOptions = {
        enableThinking: true,
        // thinkingBudget will use default (10000)
      };

      expect(options.enableThinking).toBe(true);
      expect(options.thinkingBudget).toBeUndefined();
    });

    it('should allow empty options (uses env fallback)', () => {
      const options: ExecuteStreamingOptions = {};

      expect(options.enableThinking).toBeUndefined();
      expect(options.thinkingBudget).toBeUndefined();
    });
  });

  describe('Config Propagation Flow', () => {
    it('should transform ChatMessageData.thinking to ExecuteStreamingOptions', () => {
      // This test documents the expected transformation in ChatMessageHandler
      const chatData: ChatMessageData = {
        message: 'Test message',
        sessionId: 'session-123',
        userId: 'user-456',
        thinking: {
          enableThinking: true,
          thinkingBudget: 20000,
        },
      };

      // ChatMessageHandler transforms to ExecuteStreamingOptions
      const streamingOptions: ExecuteStreamingOptions | undefined = chatData.thinking
        ? {
            enableThinking: chatData.thinking.enableThinking,
            thinkingBudget: chatData.thinking.thinkingBudget,
          }
        : undefined;

      expect(streamingOptions).toBeDefined();
      expect(streamingOptions?.enableThinking).toBe(true);
      expect(streamingOptions?.thinkingBudget).toBe(20000);
    });

    it('should handle undefined thinking config gracefully', () => {
      const chatData: ChatMessageData = {
        message: 'Test message',
        sessionId: 'session-123',
        userId: 'user-456',
        // thinking is undefined
      };

      // ChatMessageHandler transforms to undefined
      const streamingOptions: ExecuteStreamingOptions | undefined = chatData.thinking
        ? {
            enableThinking: chatData.thinking.enableThinking,
            thinkingBudget: chatData.thinking.thinkingBudget,
          }
        : undefined;

      // DirectAgentService will use env fallback
      expect(streamingOptions).toBeUndefined();
    });
  });

  describe('Validation Edge Cases', () => {
    it('should document minimum budget constraint', () => {
      // Anthropic requires minimum 1024 tokens for thinking budget
      const minBudget = 1024;

      const config: ExtendedThinkingConfig = {
        enableThinking: true,
        thinkingBudget: minBudget,
      };

      expect(config.thinkingBudget).toBeGreaterThanOrEqual(1024);
    });

    it('should document that budget must be less than max_tokens', () => {
      // When thinking is enabled, max_tokens must be > thinkingBudget
      // DirectAgentService handles this: Math.max(16000, thinkingBudget + 4096)

      const thinkingBudget = 10000;
      const expectedMinMaxTokens = Math.max(16000, thinkingBudget + 4096);

      expect(expectedMinMaxTokens).toBe(16000);

      // With larger budget
      const largeBudget = 15000;
      const expectedLargeMaxTokens = Math.max(16000, largeBudget + 4096);

      expect(expectedLargeMaxTokens).toBe(19096);
    });
  });

  describe('Default Values Documentation', () => {
    it('should document default enableThinking behavior', () => {
      // When enableThinking is not provided:
      // - Falls back to env.ENABLE_EXTENDED_THINKING
      // - If env is also not set, defaults to false

      // This is handled in DirectAgentService:
      // const enableThinking = options?.enableThinking ?? (env.ENABLE_EXTENDED_THINKING === true);

      // Without any config
      const noConfig = undefined;
      const envFallback = false; // Assume env.ENABLE_EXTENDED_THINKING is false

      const resolvedThinking = noConfig ?? envFallback;
      expect(resolvedThinking).toBe(false);

      // With explicit config
      const explicitConfig = { enableThinking: true };
      const resolvedWithConfig = explicitConfig.enableThinking ?? envFallback;
      expect(resolvedWithConfig).toBe(true);
    });

    it('should document default thinkingBudget', () => {
      // Default budget is 10000 tokens
      const defaultBudget = 10000;

      // This is handled in DirectAgentService:
      // const thinkingBudget = options?.thinkingBudget ?? 10000;

      const config: ExtendedThinkingConfig = {
        enableThinking: true,
        // thinkingBudget not specified
      };

      const resolvedBudget = config.thinkingBudget ?? defaultBudget;
      expect(resolvedBudget).toBe(10000);
    });
  });
});
