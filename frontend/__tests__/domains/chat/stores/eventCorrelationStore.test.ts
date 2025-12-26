/**
 * EventCorrelationStore Tests
 *
 * Unit tests for the event correlation store that tracks event relationships.
 * Gap #3 Fix: Complete correlationId tracking.
 *
 * @module __tests__/domains/chat/stores/eventCorrelationStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent } from '@bc-agent/shared';

import {
  getEventCorrelationStore,
  resetEventCorrelationStore,
} from '../../../../src/domains/chat/stores/eventCorrelationStore';

// Helper to create timestamps
const now = () => new Date().toISOString();

describe('EventCorrelationStore', () => {
  beforeEach(() => {
    resetEventCorrelationStore();
  });

  // ============================================================================
  // trackEvent
  // ============================================================================

  describe('trackEvent', () => {
    it('should track a basic event', () => {
      const event: AgentEvent = {
        type: 'message_chunk',
        eventId: 'evt-1',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'transient',
      };

      getEventCorrelationStore().getState().trackEvent(event);

      const state = getEventCorrelationStore().getState();
      expect(state.correlations.size).toBe(1);
      expect(state.correlations.has('evt-1')).toBe(true);

      const tracked = state.correlations.get('evt-1');
      expect(tracked?.type).toBe('message_chunk');
      expect(tracked?.sessionId).toBe('session-1');
    });

    it('should track event with correlationId', () => {
      const event = {
        type: 'tool_result' as const,
        eventId: 'evt-result-1',
        sessionId: 'session-1',
        correlationId: 'corr-123',
        timestamp: now(),
        persistenceState: 'persisted' as const,
      };

      getEventCorrelationStore().getState().trackEvent(event as AgentEvent);

      const state = getEventCorrelationStore().getState();
      const tracked = state.correlations.get('evt-result-1');
      expect(tracked?.correlationId).toBe('corr-123');
    });

    it('should group events by correlationId', () => {
      const event1 = {
        type: 'tool_use' as const,
        eventId: 'evt-1',
        correlationId: 'corr-abc',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'persisted' as const,
      };
      const event2 = {
        type: 'tool_result' as const,
        eventId: 'evt-2',
        correlationId: 'corr-abc',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'persisted' as const,
      };

      const store = getEventCorrelationStore().getState();
      store.trackEvent(event1 as AgentEvent);
      store.trackEvent(event2 as AgentEvent);

      const state = getEventCorrelationStore().getState();
      const group = state.correlationGroups.get('corr-abc');
      expect(group).toEqual(['evt-1', 'evt-2']);
    });

    it('should track parent-child relationships', () => {
      const parentEvent: AgentEvent = {
        type: 'message',
        eventId: 'evt-parent',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'persisted',
      };
      const childEvent = {
        type: 'message_chunk' as const,
        eventId: 'evt-child',
        parentEventId: 'evt-parent',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'transient' as const,
      };

      const store = getEventCorrelationStore().getState();
      store.trackEvent(parentEvent);
      store.trackEvent(childEvent as AgentEvent);

      const state = getEventCorrelationStore().getState();
      const children = state.eventChains.get('evt-parent');
      expect(children).toEqual(['evt-child']);
    });

    it('should not duplicate events in groups', () => {
      const event = {
        type: 'message_chunk' as const,
        eventId: 'evt-1',
        correlationId: 'corr-123',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'transient' as const,
      };

      const store = getEventCorrelationStore().getState();
      store.trackEvent(event as AgentEvent);
      store.trackEvent(event as AgentEvent); // Track same event twice

      const state = getEventCorrelationStore().getState();
      const group = state.correlationGroups.get('corr-123');
      expect(group).toHaveLength(1);
    });
  });

  // ============================================================================
  // getCorrelatedEvents
  // ============================================================================

  describe('getCorrelatedEvents', () => {
    it('should return all events with same correlationId', () => {
      const events = [
        { type: 'tool_use', eventId: 'evt-1', correlationId: 'corr-xyz', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'tool_result', eventId: 'evt-2', correlationId: 'corr-xyz', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message', eventId: 'evt-3', correlationId: 'corr-other', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      const correlated = getEventCorrelationStore().getState().getCorrelatedEvents('corr-xyz');
      expect(correlated).toHaveLength(2);
      expect(correlated.map((c) => c.eventId)).toEqual(['evt-1', 'evt-2']);
    });

    it('should return empty array for unknown correlationId', () => {
      const correlated = getEventCorrelationStore().getState().getCorrelatedEvents('nonexistent');
      expect(correlated).toEqual([]);
    });
  });

  // ============================================================================
  // getEventChain
  // ============================================================================

  describe('getEventChain', () => {
    it('should return event chain with children', () => {
      const events = [
        { type: 'message', eventId: 'parent', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message_chunk', eventId: 'child-1', parentEventId: 'parent', sessionId: 's1', timestamp: now(), persistenceState: 'transient' },
        { type: 'message_chunk', eventId: 'child-2', parentEventId: 'parent', sessionId: 's1', timestamp: now(), persistenceState: 'transient' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      const chain = getEventCorrelationStore().getState().getEventChain('parent');
      expect(chain).toHaveLength(3);
      expect(chain.map((c) => c.eventId)).toContain('parent');
      expect(chain.map((c) => c.eventId)).toContain('child-1');
      expect(chain.map((c) => c.eventId)).toContain('child-2');
    });

    it('should handle nested chains', () => {
      const events = [
        { type: 'message', eventId: 'root', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'thinking', eventId: 'level-1', parentEventId: 'root', sessionId: 's1', timestamp: now(), persistenceState: 'transient' },
        { type: 'thinking_chunk', eventId: 'level-2', parentEventId: 'level-1', sessionId: 's1', timestamp: now(), persistenceState: 'transient' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      const chain = getEventCorrelationStore().getState().getEventChain('root');
      expect(chain).toHaveLength(3);
    });

    it('should handle circular references gracefully', () => {
      const events = [
        { type: 'message', eventId: 'evt-a', parentEventId: 'evt-b', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message', eventId: 'evt-b', parentEventId: 'evt-a', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      // Should not infinite loop
      const chain = getEventCorrelationStore().getState().getEventChain('evt-a');
      expect(chain.length).toBeLessThanOrEqual(2);
    });

    it('should return single event for leaf nodes', () => {
      const event = { type: 'message', eventId: 'leaf', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' };
      getEventCorrelationStore().getState().trackEvent(event as unknown as AgentEvent);

      const chain = getEventCorrelationStore().getState().getEventChain('leaf');
      expect(chain).toHaveLength(1);
      expect(chain[0]?.eventId).toBe('leaf');
    });
  });

  // ============================================================================
  // getEvent
  // ============================================================================

  describe('getEvent', () => {
    it('should return event by ID', () => {
      const event: AgentEvent = {
        type: 'complete',
        eventId: 'evt-complete',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'persisted',
      };

      getEventCorrelationStore().getState().trackEvent(event);

      const retrieved = getEventCorrelationStore().getState().getEvent('evt-complete');
      expect(retrieved?.type).toBe('complete');
    });

    it('should return undefined for unknown ID', () => {
      const retrieved = getEventCorrelationStore().getState().getEvent('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  // ============================================================================
  // clearSession
  // ============================================================================

  describe('clearSession', () => {
    it('should clear all events for a specific session', () => {
      const events = [
        { type: 'message', eventId: 'evt-s1-1', sessionId: 'session-1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message', eventId: 'evt-s1-2', sessionId: 'session-1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message', eventId: 'evt-s2-1', sessionId: 'session-2', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      expect(getEventCorrelationStore().getState().correlations.size).toBe(3);

      getEventCorrelationStore().getState().clearSession('session-1');

      const state = getEventCorrelationStore().getState();
      expect(state.correlations.size).toBe(1);
      expect(state.correlations.has('evt-s2-1')).toBe(true);
      expect(state.correlations.has('evt-s1-1')).toBe(false);
    });

    it('should clear correlation groups for session', () => {
      const events = [
        { type: 'tool_use', eventId: 'evt-1', correlationId: 'corr-1', sessionId: 'session-1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'tool_result', eventId: 'evt-2', correlationId: 'corr-1', sessionId: 'session-1', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      expect(getEventCorrelationStore().getState().correlationGroups.get('corr-1')).toHaveLength(2);

      getEventCorrelationStore().getState().clearSession('session-1');

      expect(getEventCorrelationStore().getState().correlationGroups.has('corr-1')).toBe(false);
    });

    it('should clear everything when no sessionId provided', () => {
      const events = [
        { type: 'message', eventId: 'evt-1', sessionId: 'session-1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message', eventId: 'evt-2', sessionId: 'session-2', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      getEventCorrelationStore().getState().clearSession();

      const state = getEventCorrelationStore().getState();
      expect(state.correlations.size).toBe(0);
      expect(state.correlationGroups.size).toBe(0);
      expect(state.eventChains.size).toBe(0);
    });
  });

  // ============================================================================
  // reset
  // ============================================================================

  describe('reset', () => {
    it('should reset all state to initial', () => {
      const events = [
        { type: 'message', eventId: 'evt-1', correlationId: 'corr-1', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'message', eventId: 'evt-2', parentEventId: 'evt-1', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      expect(getEventCorrelationStore().getState().correlations.size).toBe(2);

      getEventCorrelationStore().getState().reset();

      const state = getEventCorrelationStore().getState();
      expect(state.correlations.size).toBe(0);
      expect(state.correlationGroups.size).toBe(0);
      expect(state.eventChains.size).toBe(0);
    });
  });

  // ============================================================================
  // Integration
  // ============================================================================

  describe('Integration: Full Event Flow', () => {
    it('should track complete tool execution flow', () => {
      const correlationId = 'tool-exec-123';

      const events = [
        { type: 'tool_use', eventId: 'tool-start', correlationId, toolName: 'search', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'tool_result', eventId: 'tool-end', correlationId, success: true, sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      const correlated = getEventCorrelationStore().getState().getCorrelatedEvents(correlationId);
      expect(correlated).toHaveLength(2);
      expect(correlated[0]?.type).toBe('tool_use');
      expect(correlated[1]?.type).toBe('tool_result');
    });

    it('should handle multiple concurrent correlations', () => {
      const events = [
        { type: 'tool_use', eventId: 'tool-1-start', correlationId: 'corr-1', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'tool_use', eventId: 'tool-2-start', correlationId: 'corr-2', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'tool_result', eventId: 'tool-2-end', correlationId: 'corr-2', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
        { type: 'tool_result', eventId: 'tool-1-end', correlationId: 'corr-1', sessionId: 's1', timestamp: now(), persistenceState: 'persisted' },
      ];

      const store = getEventCorrelationStore().getState();
      events.forEach((e) => store.trackEvent(e as unknown as AgentEvent));

      const corr1 = getEventCorrelationStore().getState().getCorrelatedEvents('corr-1');
      const corr2 = getEventCorrelationStore().getState().getCorrelatedEvents('corr-2');

      expect(corr1.map((c) => c.eventId)).toEqual(['tool-1-start', 'tool-1-end']);
      expect(corr2.map((c) => c.eventId)).toEqual(['tool-2-start', 'tool-2-end']);
    });
  });
});
