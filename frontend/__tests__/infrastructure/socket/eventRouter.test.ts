/**
 * EventRouter Tests
 *
 * TDD tests for event routing and filtering logic.
 * NOTE: Sync architecture - chunk types removed. Tests updated to reflect complete message pattern.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentEventFactory } from '../../fixtures/AgentEventFactory';
import type { AgentEvent } from '@bc-agent/shared';

// Import after any mocks
import { EventRouter } from '@/src/infrastructure/socket/eventRouter';

describe('EventRouter', () => {
  let router: EventRouter;
  let receivedEvents: AgentEvent[];
  let mockUnsubscribe: ReturnType<typeof vi.fn>;

  // Mock SocketClient-like object
  const createMockSocketClient = () => {
    const listeners: Array<(event: AgentEvent) => void> = [];
    return {
      onAgentEvent: vi.fn((callback: (event: AgentEvent) => void) => {
        listeners.push(callback);
        mockUnsubscribe = vi.fn(() => {
          const idx = listeners.indexOf(callback);
          if (idx >= 0) listeners.splice(idx, 1);
        });
        return mockUnsubscribe;
      }),
      // Test helper to trigger events
      _triggerEvent: (event: AgentEvent) => {
        listeners.forEach((cb) => cb(event));
      },
    };
  };

  beforeEach(() => {
    router = new EventRouter();
    receivedEvents = [];
    mockUnsubscribe = vi.fn();
    AgentEventFactory.resetSequence();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize()', () => {
    it('routes agent:event to onEvent callback', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      const messageEvent = AgentEventFactory.message({ sessionId: 'session-123' });
      mockClient._triggerEvent(messageEvent);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(messageEvent);
    });

    it('returns unsubscribe function', () => {
      const mockClient = createMockSocketClient();

      const unsubscribe = router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('sessionId filtering', () => {
    it('routes events matching current sessionId', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      const event = AgentEventFactory.message({ sessionId: 'session-123' });
      mockClient._triggerEvent(event);

      expect(receivedEvents).toHaveLength(1);
    });

    it('ignores events from different sessionId', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      const event = AgentEventFactory.message({ sessionId: 'different-session' });
      mockClient._triggerEvent(event);

      expect(receivedEvents).toHaveLength(0);
    });

    it('routes events without sessionId (legacy compatibility)', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      // Event without sessionId should pass through
      const event = AgentEventFactory.message();
      delete (event as { sessionId?: string }).sessionId;
      mockClient._triggerEvent(event);

      expect(receivedEvents).toHaveLength(1);
    });
  });

  describe('isComplete guard', () => {
    it('ignores transient events after complete', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      // First send a complete event
      const completeEvent = AgentEventFactory.complete({ sessionId: 'session-123' });
      mockClient._triggerEvent(completeEvent);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('complete');

      // Now send a late session_start (transient) - should be ignored
      const lateSessionStart = AgentEventFactory.sessionStart({ sessionId: 'session-123' });
      mockClient._triggerEvent(lateSessionStart);

      // Still only 1 event (the complete)
      expect(receivedEvents).toHaveLength(1);
    });

    it('blocks error events after complete (transient events are filtered)', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      // Complete event
      mockClient._triggerEvent(AgentEventFactory.complete({ sessionId: 'session-123' }));

      // Error event is transient and should be blocked after complete
      // (same as session_start - once complete, no more transient events)
      const errorEvent = AgentEventFactory.error({ sessionId: 'session-123' });
      mockClient._triggerEvent(errorEvent);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('complete');
    });

    it('allows persisted events after complete', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      // Complete event
      mockClient._triggerEvent(AgentEventFactory.complete({ sessionId: 'session-123' }));

      // Persisted message event should still pass through
      const messageEvent = AgentEventFactory.message({ sessionId: 'session-123' });
      mockClient._triggerEvent(messageEvent);

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[1].type).toBe('message');
    });
  });

  describe('reset()', () => {
    it('resets isComplete flag allowing new events', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      // Complete the first conversation
      mockClient._triggerEvent(AgentEventFactory.complete({ sessionId: 'session-123' }));
      expect(receivedEvents).toHaveLength(1);

      // Reset the router (new message sent)
      router.reset();

      // Now events should be accepted again
      mockClient._triggerEvent(AgentEventFactory.message({ sessionId: 'session-123' }));
      expect(receivedEvents).toHaveLength(2);
    });
  });

  describe('event flow sequences', () => {
    it('processes complete chat flow in order (sync architecture)', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      // Simulate typical sync flow (no chunks)
      const flow = [
        AgentEventFactory.sessionStart({ sessionId: 'session-123' }),
        AgentEventFactory.userMessageConfirmed({ sessionId: 'session-123' }),
        AgentEventFactory.thinking({ sessionId: 'session-123' }),
        AgentEventFactory.message({ sessionId: 'session-123' }),
        AgentEventFactory.complete({ sessionId: 'session-123' }),
      ];

      flow.forEach((event) => mockClient._triggerEvent(event));

      expect(receivedEvents).toHaveLength(5);
      expect(receivedEvents.map((e) => e.type)).toEqual([
        'session_start',
        'user_message_confirmed',
        'thinking',
        'message',
        'complete',
      ]);
    });

    it('handles tool flow correctly', () => {
      const mockClient = createMockSocketClient();

      router.initialize(
        mockClient as unknown as Parameters<typeof router.initialize>[0],
        'session-123',
        (event) => receivedEvents.push(event)
      );

      const flow = [
        AgentEventFactory.sessionStart({ sessionId: 'session-123' }),
        AgentEventFactory.toolUse({ sessionId: 'session-123' }),
        AgentEventFactory.toolResult({ sessionId: 'session-123' }),
        AgentEventFactory.message({ sessionId: 'session-123' }),
        AgentEventFactory.complete({ sessionId: 'session-123' }),
      ];

      flow.forEach((event) => mockClient._triggerEvent(event));

      expect(receivedEvents).toHaveLength(5);
      expect(receivedEvents.map((e) => e.type)).toEqual([
        'session_start',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ]);
    });
  });
});
