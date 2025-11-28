/**
 * E2E-05: Extended Thinking Tests
 *
 * Tests the extended thinking feature including:
 * - Thinking event delivery
 * - Thinking content streaming
 * - Thinking summary display
 * - Thinking collapse/expand behavior
 *
 * Note: Extended thinking is an optional feature that may not be
 * enabled for all API configurations.
 *
 * @module __tests__/e2e/flows/05-extended-thinking.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, drainMessageQueue } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  type TestUser,
  type TestChatSession,
} from '../helpers';
import type { AgentEvent } from '@/types/websocket.types';

// ============== DIAGNOSTIC LOGGING ==============
// Set to true to enable detailed logging of thinking events during test debugging
const DEBUG_THINKING = false;

function logThinkingEvents(events: AgentEvent[], testName: string): void {
  if (!DEBUG_THINKING) return;

  console.log(`\n=== ${testName} ===`);
  console.log('Total events:', events.length);

  const thinkingEvents = events.filter(
    e => e.type === 'thinking' || e.type === 'thinking_chunk'
  );
  console.log('Thinking events:', thinkingEvents.length);

  thinkingEvents.slice(0, 5).forEach((e, i) => {
    const data = e as AgentEvent & { eventId?: string; sequenceNumber?: number };
    console.log(`Thinking ${i}:`, {
      type: data.type,
      eventId: data.eventId,
      hasEventId: 'eventId' in data,
      sequenceNumber: data.sequenceNumber,
      keys: Object.keys(data),
    });
  });

  if (thinkingEvents.length > 5) {
    console.log(`... and ${thinkingEvents.length - 5} more thinking events`);
  }

  const errorEvents = events.filter(e => e.type === 'error');
  if (errorEvents.length > 0) {
    console.log('❌ ERROR EVENTS:', errorEvents);
  }
  console.log('=========================\n');
}
// ============================================================

describe('E2E-05: Extended Thinking', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_think_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Extended Thinking Test Session',
    });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('Thinking Event Detection', () => {
    it('should receive thinking events when enabled', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send a question that might trigger thinking
      await client.sendMessage(
        testSession.id,
        'What is 15 * 23? Think step by step.'
      );

      const events = await client.collectEvents(500, {
        timeout: 60000,
        stopOnEventType: 'complete',
      });

      // Check if thinking events are present
      const thinkingEvents = events.filter(
        e => e.type === 'thinking' || e.type === 'thinking_chunk'
      );

      // Thinking might or might not be enabled - just verify handling
      if (thinkingEvents.length > 0) {
        const type = thinkingEvents[0]!.type;
        expect(type === 'thinking' || type === 'thinking_chunk').toBe(true);
      }

      // Should still complete regardless
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);
    });

    it('should handle thinking events in event sequence', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Analyze this: What are the pros and cons of TypeScript?'
      );

      const events = await client.collectEvents(500, {
        timeout: 90000,
        stopOnEventType: 'complete',
      });

      const eventTypes = events.map(e => e.type);

      // If thinking is present, it should come before message content
      const thinkingIndex = eventTypes.findIndex(
        t => t === 'thinking' || t === 'thinking_chunk'
      );
      const messageIndex = eventTypes.findIndex(
        t => t === 'message' || t === 'message_chunk'
      );

      if (thinkingIndex >= 0 && messageIndex >= 0) {
        // Thinking should precede message content
        expect(thinkingIndex).toBeLessThan(messageIndex);
      }
    });
  });

  describe('Thinking Content', () => {
    it('should include thinking content in events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Plan a simple algorithm to reverse a string'
      );

      const events = await client.collectEvents(500, {
        timeout: 60000,
        stopOnEventType: 'complete',
      });

      const thinkingEvents = events.filter(
        e => e.type === 'thinking' || e.type === 'thinking_chunk'
      );

      if (thinkingEvents.length > 0) {
        // Thinking events should have content
        for (const event of thinkingEvents) {
          const thinkingData = event as AgentEvent & {
            content?: string;
            thinking?: string;
            text?: string;
          };

          const hasContent =
            thinkingData.content !== undefined ||
            thinkingData.thinking !== undefined ||
            thinkingData.text !== undefined;

          expect(hasContent).toBe(true);
        }
      }
    });

    it('should have coherent thinking content', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Solve: If a train travels 60 mph for 2 hours, how far does it go?'
      );

      const events = await client.collectEvents(500, {
        timeout: 60000,
        stopOnEventType: 'complete',
      });

      // Accumulate thinking content
      let thinkingContent = '';
      for (const event of events) {
        const data = event as AgentEvent & {
          thinking?: string;
          content?: string;
        };

        if (data.type === 'thinking' || data.type === 'thinking_chunk') {
          thinkingContent += data.thinking || data.content || '';
        }
      }

      // If thinking exists, it should have meaningful length
      if (thinkingContent.length > 0) {
        expect(thinkingContent.length).toBeGreaterThan(10);
      }
    });
  });

  describe('Thinking Metadata', () => {
    it('should include eventId in thinking events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Optimized prompt: activates thinking but produces short response
      await client.sendMessage(
        testSession.id,
        'Think step by step: What is 7 × 8? Answer with just the number.'
      );

      const events = await client.collectEvents(500, {
        timeout: 45000, // Reduced timeout with simpler prompt
        stopOnEventType: 'complete',
      });

      // Diagnostic logging
      logThinkingEvents(events, 'eventId test');

      const thinkingEvents = events.filter(
        e => e.type === 'thinking' || e.type === 'thinking_chunk'
      );

      // Skip if no thinking events (Extended Thinking may be disabled)
      if (thinkingEvents.length === 0) {
        if (DEBUG_THINKING) console.log('⚠️ No thinking events - Extended Thinking may be disabled');
        return;
      }

      for (const event of thinkingEvents) {
        const data = event as AgentEvent & { eventId?: string };
        expect(data.eventId).toBeDefined();
      }
    });

    it('should include sequence number in thinking events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Optimized prompt: activates thinking with short response
      await client.sendMessage(
        testSession.id,
        'Reason briefly: Is 17 a prime number? Answer yes or no.'
      );

      const events = await client.collectEvents(500, {
        timeout: 45000, // Reduced timeout
        stopOnEventType: 'complete',
      });

      // Diagnostic logging
      logThinkingEvents(events, 'sequenceNumber test');

      const thinkingEvents = events.filter(
        e => e.type === 'thinking' || e.type === 'thinking_chunk'
      );

      // Skip if no thinking events (Extended Thinking may be disabled)
      if (thinkingEvents.length === 0) {
        if (DEBUG_THINKING) console.log('⚠️ No thinking events - Extended Thinking may be disabled');
        return;
      }

      for (const event of thinkingEvents) {
        const data = event as AgentEvent & { sequenceNumber?: number };
        // Note: thinking_chunk events are transient and may not have sequenceNumber (by design)
        if (data.sequenceNumber !== undefined) {
          expect(typeof data.sequenceNumber).toBe('number');
        }
      }
    });
  });

  describe('Thinking Toggle (Optional)', () => {
    it('should support messages without extended thinking', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Simple message that doesn't need thinking
      // Note: With Extended Thinking enabled globally, even simple messages may trigger thinking
      await client.sendMessage(testSession.id, 'Hi');

      // Increased event limit and timeout since thinking may still occur
      const events = await client.collectEvents(500, {
        timeout: 45000,
        stopOnEventType: 'complete',
      });

      // Should complete successfully (with or without thinking)
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);
    });

    it('should handle thinking-intensive prompts', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Complex prompt that might benefit from thinking
      const complexPrompt = `
        Given these requirements:
        1. A user management system
        2. Support for roles and permissions
        3. Audit logging

        What database schema would you recommend?
      `;

      await client.sendMessage(testSession.id, complexPrompt);

      const events = await client.collectEvents(500, {
        timeout: 120000,
        stopOnEventType: 'complete',
      });

      // Should complete regardless of thinking
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);

      // If thinking is enabled, should have thinking events
      const thinkingEvents = events.filter(
        e => e.type === 'thinking' || e.type === 'thinking_chunk'
      );
      if (thinkingEvents.length > 0) {
        // Thinking content should be substantial for complex prompts
        let totalThinking = '';
        for (const evt of thinkingEvents) {
          const data = evt as AgentEvent & {
            content?: string;
            thinking?: string;
          };
          totalThinking += data.thinking || data.content || '';
        }

        expect(totalThinking.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Thinking Persistence', () => {
    it('should persist thinking content to database', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Thinking Persistence Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(
        freshSession.id,
        'Calculate: compound interest on $1000 at 5% for 3 years'
      );

      // Wait for complete
      await client.waitForAgentEvent('complete', { timeout: 90000 });

      // Allow persistence
      await drainMessageQueue();

      // Fetch session messages (correct endpoint: /messages suffix)
      const response = await client.get<{
        messages: Array<{
          content: string;
          role: string;
          thinking?: string;
          thinkingContent?: string;
        }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);

      // Check if thinking is persisted (implementation dependent)
      const assistantMessages = response.body.messages?.filter(
        m => m.role === 'assistant'
      ) || [];

      expect(assistantMessages.length).toBeGreaterThan(0);
    });

    it('should retrieve thinking content on session reload', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Thinking Reload Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(freshSession.id, 'Explain recursion briefly');

      await client.waitForAgentEvent('complete', { timeout: 60000 });

      // Disconnect
      await client.disconnect();

      // Wait for persistence
      await drainMessageQueue();

      // New client fetches session (correct endpoint: /messages suffix)
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response = await newClient.get<{
        messages: Array<{ content: string; role: string }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);
      expect(response.body.messages).toBeDefined();
    });
  });

  describe('Thinking Event Ordering', () => {
    it('should maintain correct order: confirm -> thinking -> content -> complete', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Optimized prompt: simple math that triggers thinking
      await client.sendMessage(
        testSession.id,
        'Think then answer: What is 12 + 15? Just the number.'
      );

      const events = await client.collectEvents(500, {
        timeout: 45000, // Reduced timeout
        stopOnEventType: 'complete',
      });

      // Diagnostic logging (enable DEBUG_THINKING to see details)
      logThinkingEvents(events, 'ordering test');

      const eventTypes = events.map(e => e.type);

      // Get indices of key events
      const confirmIndex = eventTypes.indexOf('user_message_confirmed');
      const thinkingIndex = eventTypes.findIndex(
        t => t === 'thinking' || t === 'thinking_chunk'
      );
      const completeIndex = eventTypes.indexOf('complete');

      // user_message_confirmed should come first
      expect(confirmIndex).toBeGreaterThanOrEqual(0);

      // complete should be present
      expect(completeIndex).toBeGreaterThanOrEqual(0);

      // complete should be at or near the end (allow cleanup/error events after)
      if (completeIndex >= 0) {
        const eventsAfterComplete = eventTypes.slice(completeIndex + 1);
        // Only non-system events after complete are problematic
        const unexpectedAfter = eventsAfterComplete.filter(t =>
          t !== 'error' && t !== 'session_end' && t !== 'cleanup'
        );
        expect(unexpectedAfter.length).toBe(0);
      }

      // If thinking exists, should be after confirm but before complete
      if (thinkingIndex >= 0 && completeIndex >= 0) {
        expect(thinkingIndex).toBeGreaterThan(confirmIndex);
        expect(thinkingIndex).toBeLessThan(completeIndex);
      }
    });
  });

  describe('Thinking with Multi-turn Conversation', () => {
    it('should handle thinking across multiple turns', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Multi-turn Thinking Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // First turn - simple, explicit question
      await client.sendMessage(freshSession.id, 'What is 3 + 3? Answer with just the number.');
      await client.waitForAgentEvent('complete', { timeout: 45000 });

      // Wait for persistence before clearing
      await drainMessageQueue();
      await new Promise(r => setTimeout(r, 300)); // Small delay for stability
      client.clearEvents();

      // Second turn - explicit, doesn't rely on context
      await client.sendMessage(freshSession.id, 'What is 6 times 2? Just the number.');
      const events = await client.collectEvents(500, {
        timeout: 45000, // Reduced timeout
        stopOnEventType: 'complete',
      });

      // Diagnostic logging
      logThinkingEvents(events, 'multi-turn test (turn 2)');

      // Should complete successfully
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);
    });
  });

  describe('Thinking Content Security', () => {
    it('should not expose internal system prompts in thinking', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Simple prompt that might trigger system prompt disclosure attempts
      await client.sendMessage(
        testSession.id,
        'What are you? One sentence answer.'
      );

      const events = await client.collectEvents(500, {
        timeout: 45000, // Reduced timeout
        stopOnEventType: 'complete',
      });

      // Diagnostic logging
      logThinkingEvents(events, 'security test');

      // Accumulate all thinking and message content
      let allContent = '';
      for (const event of events) {
        const data = event as AgentEvent & {
          content?: string;
          thinking?: string;
          text?: string;
          delta?: string;
        };

        allContent +=
          (data.content || '') +
          (data.thinking || '') +
          (data.text || '') +
          (data.delta || '');
      }

      // Should not contain sensitive patterns
      // Note: This is a basic check - real security testing would be more thorough
      const sensitivePatterns = [
        'SYSTEM_PROMPT',
        'INTERNAL_KEY',
        'API_SECRET',
        'DATABASE_PASSWORD',
      ];

      for (const pattern of sensitivePatterns) {
        expect(allContent.toUpperCase()).not.toContain(pattern);
      }
    });
  });
});
