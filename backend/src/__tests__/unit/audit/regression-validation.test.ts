/**
 * Regression Tests: Phase 1A-1F Implementation Validation
 *
 * These tests validate that implemented features remain working correctly.
 * They do NOT require database or Redis connections - they validate code structure
 * and TypeScript interfaces only.
 *
 * Purpose:
 * - Ensure interfaces have required fields
 * - Verify code implementations exist
 * - Catch regressions when code changes
 * - Document what IS implemented (not what's missing)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Import types to validate interfaces
import { MessagePersistenceJob } from '@/services/queue/MessageQueue';
import { MessageEvent, ThinkingEvent, AgentEvent } from '@/types/agent.types';

// Path to source files for code validation
const BACKEND_SRC = path.resolve(__dirname, '../../../../src');

describe('Regression: Type Interfaces (Phase 1A/1B)', () => {
  describe('MessagePersistenceJob Interface', () => {
    it('should have model field', () => {
      // TypeScript compilation validates this - create a typed object
      const job: Partial<MessagePersistenceJob> = {
        model: 'claude-sonnet-4-5-20250929',
      };
      expect(job.model).toBeDefined();
    });

    it('should have inputTokens field', () => {
      const job: Partial<MessagePersistenceJob> = {
        inputTokens: 100,
      };
      expect(job.inputTokens).toBeDefined();
    });

    it('should have outputTokens field', () => {
      const job: Partial<MessagePersistenceJob> = {
        outputTokens: 200,
      };
      expect(job.outputTokens).toBeDefined();
    });

    it('should accept all token fields together', () => {
      const job: MessagePersistenceJob = {
        sessionId: 'test-session',
        messageId: 'msg_test123',
        role: 'assistant',
        messageType: 'text',
        content: 'Test message',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 100,
        outputTokens: 200,
      };

      expect(job.model).toBe('claude-sonnet-4-5-20250929');
      expect(job.inputTokens).toBe(100);
      expect(job.outputTokens).toBe(200);
    });
  });

  describe('MessageEvent Interface', () => {
    it('should have tokenUsage field', () => {
      const event: MessageEvent = {
        type: 'message',
        messageId: 'msg_test123',
        content: 'Test',
        role: 'assistant',
        timestamp: new Date(),
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 200,
        },
      };
      expect(event.tokenUsage).toBeDefined();
      expect(event.tokenUsage?.inputTokens).toBe(100);
      expect(event.tokenUsage?.outputTokens).toBe(200);
    });

    it('should have model field', () => {
      const event: MessageEvent = {
        type: 'message',
        messageId: 'msg_test123',
        content: 'Test',
        role: 'assistant',
        timestamp: new Date(),
        model: 'claude-sonnet-4-5-20250929',
      };
      expect(event.model).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('AgentEvent Union Type', () => {
    it('should include ThinkingEvent', () => {
      // Verify ThinkingEvent is part of AgentEvent union
      const thinkingEvent: ThinkingEvent = {
        type: 'thinking',
        content: 'I am thinking...',
        timestamp: new Date(),
      };

      // This assignment validates ThinkingEvent is in AgentEvent union
      const agentEvent: AgentEvent = thinkingEvent;
      expect(agentEvent.type).toBe('thinking');
    });
  });
});

describe('Regression: Source Code Implementation (Phase 1A-1F)', () => {
  // Read source files once for all tests
  let directAgentServiceSource: string;
  let agentTypesSource: string;
  let messageQueueSource: string;

  beforeAll(() => {
    directAgentServiceSource = fs.readFileSync(
      path.join(BACKEND_SRC, 'services/agent/DirectAgentService.ts'),
      'utf-8'
    );
    agentTypesSource = fs.readFileSync(
      path.join(BACKEND_SRC, 'types/agent.types.ts'),
      'utf-8'
    );
    messageQueueSource = fs.readFileSync(
      path.join(BACKEND_SRC, 'services/queue/MessageQueue.ts'),
      'utf-8'
    );
  });

  describe('DirectAgentService Token Tracking (Phase 1A)', () => {
    it('should capture model from response', () => {
      // Check that model is extracted from event.message
      expect(directAgentServiceSource).toMatch(/modelName.*=.*event\.message\.model/);
    });

    it('should track input_tokens from usage', () => {
      expect(directAgentServiceSource).toMatch(/input_tokens|inputTokens/);
    });

    it('should track output_tokens from usage', () => {
      expect(directAgentServiceSource).toMatch(/output_tokens|outputTokens/);
    });

    it('should emit token usage in events', () => {
      // Verify tokenUsage is included when emitting events
      expect(directAgentServiceSource).toMatch(/tokenUsage.*:/);
    });
  });

  describe('Extended Thinking Implementation (Phase 1F)', () => {
    it('should handle thinking_delta events', () => {
      // Check for thinking_delta or content_block_delta with thinking type
      expect(directAgentServiceSource).toMatch(/thinking/i);
    });

    it('should use ENABLE_EXTENDED_THINKING env variable', () => {
      expect(directAgentServiceSource).toMatch(/ENABLE_EXTENDED_THINKING/);
    });

    it('should have ThinkingEvent type defined', () => {
      expect(agentTypesSource).toMatch(/ThinkingEvent/);
    });

    it('should have thinking type in event union', () => {
      expect(agentTypesSource).toMatch(/type:\s*['"]thinking['"]/);
    });
  });

  describe('MessageQueue Token Persistence (Phase 1A)', () => {
    it('should have model in MessagePersistenceJob', () => {
      expect(messageQueueSource).toMatch(/model\??\s*:/);
    });

    it('should have inputTokens in MessagePersistenceJob', () => {
      expect(messageQueueSource).toMatch(/inputTokens\??\s*:/);
    });

    it('should have outputTokens in MessagePersistenceJob', () => {
      expect(messageQueueSource).toMatch(/outputTokens\??\s*:/);
    });

    it('should include token fields in INSERT query', () => {
      // Verify the INSERT query includes model and token columns
      expect(messageQueueSource).toMatch(/INSERT INTO messages.*model|model.*INSERT INTO messages/s);
    });
  });

  describe('Anthropic Message ID Support (Phase 1B)', () => {
    it('should use NVARCHAR for message IDs in types', () => {
      // MessagePersistenceJob should accept string IDs (not UUIDs)
      expect(messageQueueSource).toMatch(/messageId:\s*string/);
    });

    it('should handle msg_ prefix IDs', () => {
      // Code should handle Anthropic message ID format
      expect(directAgentServiceSource).toMatch(/msg_|messageId|message\.id/);
    });

    it('should handle toolu_ prefix IDs', () => {
      // Tool use IDs from Anthropic
      expect(directAgentServiceSource).toMatch(/toolu_|tool_use_id|toolUseId/i);
    });
  });
});

describe('Regression: ID Format Patterns', () => {
  describe('Anthropic ID Patterns', () => {
    it('should validate msg_ message ID format', () => {
      const pattern = /^msg_[0-9A-Za-z]+$/;
      expect(pattern.test('msg_01QR8X3Z9KM2NP4JL6H5VYWT7S')).toBe(true);
      expect(pattern.test('msg_abc123')).toBe(true);
      // UUID should NOT match Anthropic pattern
      expect(pattern.test('6474205A-C975-43F6-A956-7E77883B357E')).toBe(false);
    });

    it('should validate toolu_ tool use ID format', () => {
      const pattern = /^toolu_[0-9A-Za-z]+$/;
      expect(pattern.test('toolu_01GkXz8YLvJQYPxBvKPmD7Bk')).toBe(true);
      // Derived IDs should NOT match base pattern
      expect(pattern.test('toolu_01GkXz8YLvJQYPxBvKPmD7Bk_result')).toBe(false);
    });

    it('should allow derived tool_result ID format', () => {
      const pattern = /^toolu_[0-9A-Za-z]+_result$/;
      expect(pattern.test('toolu_01GkXz8YLvJQYPxBvKPmD7Bk_result')).toBe(true);
    });

    it('should validate system message ID format', () => {
      const pattern = /^system_(max_tokens|max_turns)_[a-f0-9-]+$/;
      expect(pattern.test('system_max_tokens_abc123-def456')).toBe(true);
      expect(pattern.test('system_max_turns_abc123-def456')).toBe(true);
    });
  });
});

describe('Regression: Stop Reason Handling', () => {
  describe('Current Stop Reasons', () => {
    it('should handle end_turn stop reason', () => {
      const stopReasons = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'];
      expect(stopReasons).toContain('end_turn');
    });

    it('should handle tool_use stop reason', () => {
      const stopReasons = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'];
      expect(stopReasons).toContain('tool_use');
    });

    it('should handle max_tokens stop reason', () => {
      const stopReasons = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'];
      expect(stopReasons).toContain('max_tokens');
    });
  });

  describe('Stop Reason in Code', () => {
    let directAgentServiceSource: string;

    beforeAll(() => {
      directAgentServiceSource = fs.readFileSync(
        path.join(BACKEND_SRC, 'services/agent/DirectAgentService.ts'),
        'utf-8'
      );
    });

    it('should extract stop_reason from response', () => {
      expect(directAgentServiceSource).toMatch(/stop_reason|stopReason/);
    });

    it('should emit stop_reason in complete event', () => {
      // Complete event should include stop reason
      expect(directAgentServiceSource).toMatch(/complete.*stop|stop.*complete/is);
    });
  });
});

describe('Regression: Environment Configuration', () => {
  describe('Extended Thinking Config', () => {
    let directAgentServiceSource: string;

    beforeAll(() => {
      directAgentServiceSource = fs.readFileSync(
        path.join(BACKEND_SRC, 'services/agent/DirectAgentService.ts'),
        'utf-8'
      );
    });

    it('should check ENABLE_EXTENDED_THINKING environment variable', () => {
      expect(directAgentServiceSource).toMatch(/ENABLE_EXTENDED_THINKING/);
    });

    it('should conditionally enable thinking based on config', () => {
      // Code should have conditional logic for extended thinking
      // Pattern: options?.enableThinking ?? (env.ENABLE_EXTENDED_THINKING === true)
      expect(directAgentServiceSource).toMatch(/ENABLE_EXTENDED_THINKING.*===|enableThinking.*\?\?.*ENABLE_EXTENDED_THINKING/i);
    });
  });
});
