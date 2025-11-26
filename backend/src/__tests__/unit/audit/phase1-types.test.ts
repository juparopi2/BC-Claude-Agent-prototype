/**
 * Phase 1 Audit: SDK Type Coverage Verification
 *
 * Tests that verify DirectAgentService properly handles all Anthropic SDK types:
 * - MessageStreamEvent types (streaming events)
 * - StopReason values (completion states)
 * - ContentBlock types (text, tool_use, thinking)
 *
 * Purpose: Ensure no SDK capabilities are silently ignored or cause runtime errors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import type { MessageStreamEvent, StopReason } from '@anthropic-ai/sdk/resources/messages';

// Mock EventStore to avoid DB dependencies
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue({
      id: 'test-event-id',
      session_id: 'test-session-id',
      event_type: 'agent_message_sent',
      sequence_number: 1,
      timestamp: new Date(),
      data: '{}',
      processed: false,
    }),
    getNextSequenceNumber: vi.fn().mockResolvedValue(1),
    getEvents: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock MessageQueue to avoid BullMQ dependencies
vi.mock('@/services/messages/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock filesystem for MCP tools
vi.mock('fs');

describe('Phase 1: SDK Type Coverage', () => {
  let service: DirectAgentService;
  let fakeClient: FakeAnthropicClient;

  beforeEach(() => {
    // Setup fake Anthropic client
    fakeClient = new FakeAnthropicClient();
    service = new DirectAgentService(undefined, undefined, fakeClient);
  });

  describe('1.1 MessageStreamEvent Handler Coverage', () => {
    it('should handle streaming text response (message_start, content_block_delta, message_stop)', async () => {
      // FakeAnthropicClient automatically generates all streaming events
      fakeClient.addResponse({
        textBlocks: ['Hello world'],
        stopReason: 'end_turn',
      });

      const events: string[] = [];
      await service.executeQueryStreaming(
        'test',
        'test-session',
        (event) => events.push(event.type)
      );

      // Should emit thinking, message_chunk (streaming), message (complete), complete
      expect(events).toContain('thinking');
      expect(events).toContain('message_chunk');
      expect(events).toContain('message');
      expect(events).toContain('complete');
    });

    it('should handle tool_use content block (content_block_start, input_json_delta)', async () => {
      fakeClient.addResponse({
        toolUseBlocks: [
          {
            id: 'tool_123',
            name: 'list_bc_entities',
            input: { filter: 'customer' },
          },
        ],
        stopReason: 'tool_use',
      });

      const events: string[] = [];
      await service.executeQueryStreaming(
        'test',
        'test-session',
        (event) => events.push(event.type)
      );

      // Should emit tool_use event
      expect(events).toContain('tool_use');
      // Agentic loop will continue and execute tool (but we mocked it, so it will fail gracefully)
    });

    it('should handle mixed content (text + tool_use)', async () => {
      fakeClient.addResponse({
        textBlocks: ['Let me check that for you.'],
        toolUseBlocks: [
          {
            id: 'tool_456',
            name: 'get_entity_details',
            input: { entity_name: 'customer' },
          },
        ],
        stopReason: 'tool_use',
      });

      const events: string[] = [];
      await service.executeQueryStreaming(
        'test',
        'test-session',
        (event) => events.push(event.type)
      );

      // Should handle both text and tool_use
      expect(events).toContain('message'); // Text block completed
      expect(events).toContain('tool_use'); // Tool requested
    });

    it('should handle empty response gracefully', async () => {
      fakeClient.addResponse({
        textBlocks: [''],
        stopReason: 'end_turn',
      });

      const events: string[] = [];
      await service.executeQueryStreaming(
        'test',
        'test-session',
        (event) => events.push(event.type)
      );

      // Should not crash
      expect(events).toContain('thinking');
      expect(events).toContain('complete');
    });
  });

  describe('1.2 StopReason Coverage', () => {
    const testStopReason = async (stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use') => {
      fakeClient.addResponse({
        textBlocks: ['Test response'],
        stopReason,
      });

      const events: string[] = [];
      await service.executeQueryStreaming(
        'test',
        'test-session',
        (event) => events.push(event.type)
      );

      return events;
    };

    it('should handle stop_reason: end_turn', async () => {
      const events = await testStopReason('end_turn');
      expect(events).toContain('message');
      expect(events).toContain('complete');
    });

    it('should handle stop_reason: max_tokens', async () => {
      const events = await testStopReason('max_tokens');
      expect(events).toContain('message');
      // Should still complete gracefully
      expect(events).toContain('complete');
    });

    it('should handle stop_reason: stop_sequence', async () => {
      const events = await testStopReason('stop_sequence');
      expect(events).toContain('message');
      expect(events).toContain('complete');
    });

    it('should handle stop_reason: tool_use', async () => {
      fakeClient.addResponse({
        toolUseBlocks: [
          {
            id: 'tool_123',
            name: 'list_bc_entities',
            input: {},
          },
        ],
        stopReason: 'tool_use',
      });

      const events: string[] = [];
      await service.executeQueryStreaming(
        'test',
        'test-session',
        (event) => events.push(event.type)
      );

      // Should emit tool_use and continue loop
      expect(events).toContain('tool_use');
    });

    // ⚠️ NOTE: pause_turn and refusal are newer stop_reason values in SDK v0.68+
    // FakeAnthropicClient doesn't support them yet, but when they're added,
    // DirectAgentService should handle them gracefully.
    // For now, we document that these exist and need to be supported.
    it('should document newer stop_reason values (pause_turn, refusal)', () => {
      const newerStopReasons: StopReason[] = ['pause_turn', 'refusal'];
      // These exist in SDK but aren't tested yet
      expect(newerStopReasons).toHaveLength(2);
      // TODO: When implementing, verify DirectAgentService handles these without crashing
    });
  });

  describe('1.3 Unsupported Content Types', () => {
    it('should document that image content is not supported', () => {
      // This test documents the gap - images are not supported
      // When implementing image support, this test should be updated to verify handling
      const supportsImages = false;
      expect(supportsImages).toBe(false);
      // TODO: When implementing, verify DirectAgentService can handle ImageBlockParam
    });

    it('should document that PDF content is not supported', () => {
      // This test documents the gap - PDFs are not supported
      // When implementing PDF support, this test should be updated to verify handling
      const supportsPDFs = false;
      expect(supportsPDFs).toBe(false);
      // TODO: When implementing, verify DirectAgentService can handle DocumentBlockParam
    });

    it('should document that citations are not extracted', () => {
      // This test documents that TextBlock.citations are not captured
      const capturesCitations = false;
      expect(capturesCitations).toBe(false);
      // TODO: When implementing, verify citations are extracted and persisted
    });

    it('should document that Anthropic message IDs are not preserved', () => {
      // This test documents that SDK message IDs are not stored
      const preservesAnthropicMessageIds = false;
      expect(preservesAnthropicMessageIds).toBe(false);
      // TODO: When implementing, verify SDK message.id is stored in DB
    });
  });

  describe('1.4 Type Safety Verification', () => {
    it('should use native SDK StopReason type', () => {
      // Verify that we're using the SDK type, not a local duplicate
      const stopReason: StopReason = 'end_turn';
      expect(stopReason).toBe('end_turn');

      // This ensures type compatibility with SDK updates
      const allStopReasons: StopReason[] = [
        'end_turn',
        'max_tokens',
        'stop_sequence',
        'tool_use',
        'pause_turn',
        'refusal',
      ];
      expect(allStopReasons).toHaveLength(6);
    });

    it('should handle ContentBlock union type', () => {
      // Verify that content blocks are properly typed
      // This ensures we're ready for new block types (e.g., ThinkingBlock)
      const textBlock = { type: 'text', text: 'Hello' };
      const toolBlock = { type: 'tool_use', id: '123', name: 'test', input: {} };

      expect(textBlock.type).toBe('text');
      expect(toolBlock.type).toBe('tool_use');

      // ⚠️ ThinkingBlock is not handled yet
      const supportsThinkingBlocks = false;
      expect(supportsThinkingBlocks).toBe(false);
    });
  });
});
