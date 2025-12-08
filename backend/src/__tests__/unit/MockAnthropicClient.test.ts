import { describe, it, expect, beforeEach } from 'vitest';
import { MockAnthropicClient } from '@services/agent/MockAnthropicClient';
import type { ChatCompletionRequest } from '@services/agent/IAnthropicClient';
import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

describe('MockAnthropicClient', () => {
  let client: MockAnthropicClient;

  beforeEach(() => {
    client = new MockAnthropicClient();
  });

  describe('Pattern Matching', () => {
    it('triggers greeting pattern for Hello', async () => {
      const request: ChatCompletionRequest = {
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      };
      const response = await client.createChatCompletion(request);
      expect(response.stop_reason).toBe('end_turn');
    });

    it('triggers create customer pattern with tool use', async () => {
      const request: ChatCompletionRequest = {
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'Create customer' }],
        max_tokens: 1024,
      };
      const response = await client.createChatCompletion(request);
      expect(response.stop_reason).toBe('tool_use');
    });
  });

  describe('Interface Compliance', () => {
    it('implements IAnthropicClient', () => {
      expect(client.createChatCompletion).toBeDefined();
      expect(client.createChatCompletionStream).toBeDefined();
    });

    it('returns correct event types in streaming', async () => {
      const request: ChatCompletionRequest = {
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      };
      const events: MessageStreamEvent[] = [];
      for await (const event of client.createChatCompletionStream(request)) {
        events.push(event);
      }
      expect(events[0]?.type).toBe('message_start');
      expect(events[events.length - 1]?.type).toBe('message_stop');
    });
  });

  describe('Streaming Behavior', () => {
    it('streams events asynchronously', async () => {
      const request: ChatCompletionRequest = {
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      };
      const start = Date.now();
      let last = start;
      for await (const event of client.createChatCompletionStream(request)) {
        if (event.type === 'message_stop') break;
        last = Date.now();
      }
      expect(last - start).toBeGreaterThan(50);
    });
  });

  describe('Integration', () => {
    it('can be instantiated', () => {
      const instance = new MockAnthropicClient();
      expect(instance).toBeInstanceOf(MockAnthropicClient);
    });
  });
});
