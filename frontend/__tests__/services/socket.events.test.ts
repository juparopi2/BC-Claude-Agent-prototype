/**
 * SocketService Event Handling Tests
 *
 * Tests for handling all 16 AgentEvent types and event sourcing contract.
 *
 * @module __tests__/services/socket.events.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentEvent } from '@bc-agent/shared';

// Create mock socket factory inline for vi.mock hoisting
const { mockIo, createMockSocket, setMockSocket } = vi.hoisted(() => {
  type EventCallback = (...args: unknown[]) => void;

  interface MockSocket {
    connected: boolean;
    id: string;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    _trigger: (event: string, ...args: unknown[]) => void;
    _listeners: Map<string, Set<EventCallback>>;
  }

  function createMockSocket(options: { connected?: boolean } = {}): MockSocket {
    const listeners = new Map<string, Set<EventCallback>>();

    const socket: MockSocket = {
      connected: options.connected ?? false,
      id: `mock-socket-${Date.now()}`,
      on: vi.fn((event: string, callback: EventCallback) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(callback);
        return socket;
      }),
      off: vi.fn((event: string, callback?: EventCallback) => {
        if (callback && listeners.has(event)) listeners.get(event)!.delete(callback);
        return socket;
      }),
      emit: vi.fn(() => socket),
      once: vi.fn(() => socket),
      connect: vi.fn(() => { socket.connected = true; return socket; }),
      disconnect: vi.fn(() => { socket.connected = false; return socket; }),
      _trigger: (event: string, ...args: unknown[]) => {
        listeners.get(event)?.forEach((cb) => cb(...args));
      },
      _listeners: listeners,
    };
    return socket;
  }

  let currentMock: MockSocket | null = null;

  const mockIo = vi.fn(() => {
    if (currentMock) return currentMock;
    return createMockSocket();
  });

  function setMockSocket(socket: MockSocket): void {
    currentMock = socket;
    mockIo.mockReturnValue(socket);
  }

  return { mockIo, createMockSocket, setMockSocket };
});

// Mock socket.io-client
vi.mock('socket.io-client', () => ({ io: mockIo }));

// Mock environment
vi.mock('@/lib/config/env', () => ({
  env: { wsUrl: 'http://localhost:3002', debug: false, isDev: true, isProd: false },
}));

// Import after mocks
import {
  resetTestEnvironment,
  createConsoleSpy,
} from '../helpers/socketTestHelpers';
import {
  AgentEventFactory,
  isMessageEvent,
  isToolUseEvent,
  isApprovalRequestedEvent,
  isCompleteEvent,
  isErrorEvent,
} from '../fixtures/AgentEventFactory';
import { SocketService, resetSocketService } from '@/lib/services/socket';

type MockSocket = ReturnType<typeof createMockSocket>;

describe('Server-to-Client Event Handling', () => {
  let mockSocket: MockSocket;
  let receivedEvents: AgentEvent[];
  let service: SocketService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSocketService();
    AgentEventFactory.resetSequence();

    receivedEvents = [];
    mockSocket = createMockSocket({ connected: true });
    setMockSocket(mockSocket);

    service = new SocketService({
      onAgentEvent: (event) => receivedEvents.push(event),
    });
    service.connect();
    mockSocket._trigger('connect');
  });

  afterEach(() => {
    resetTestEnvironment();
  });

  // ============================================
  // Session Lifecycle Events (3 tests)
  // ============================================

  describe('Session Lifecycle Events', () => {
    it('should handle session_start event', () => {
      const event = AgentEventFactory.sessionStart({
        sessionId: 'test-session',
        userId: 'test-user',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'session_start',
        sessionId: 'test-session',
        userId: 'test-user',
      });
    });

    it('should handle session_end event with reason', () => {
      const reasons = ['completed', 'error', 'timeout', 'user_cancelled'] as const;

      reasons.forEach((reason, idx) => {
        const event = AgentEventFactory.sessionEnd({ reason });
        mockSocket._trigger('agent:event', event);
        expect(receivedEvents[idx]?.type).toBe('session_end');
        expect((receivedEvents[idx] as { reason: string }).reason).toBe(reason);
      });
    });

    it('should handle complete event with all reason types', () => {
      const reasons = ['success', 'error', 'max_turns', 'user_cancelled'] as const;

      reasons.forEach((reason) => {
        const event = AgentEventFactory.complete({ reason });
        mockSocket._trigger('agent:event', event);

        const lastEvent = receivedEvents[receivedEvents.length - 1];
        expect(lastEvent?.type).toBe('complete');
        expect(isCompleteEvent(lastEvent!)).toBe(true);
        if (isCompleteEvent(lastEvent!)) {
          expect(lastEvent.reason).toBe(reason);
        }
      });
    });
  });

  // ============================================
  // Extended Thinking Events (LOW PRIORITY - 1 test)
  // ============================================

  describe('Extended Thinking Events', () => {
    it('should handle thinking_chunk event (happy path only)', () => {
      const event = AgentEventFactory.thinkingChunk({
        content: 'Let me think about this...',
        blockIndex: 0,
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'thinking_chunk',
        content: 'Let me think about this...',
        blockIndex: 0,
        persistenceState: 'transient',
      });
    });
  });

  // ============================================
  // Message Events (4 tests)
  // ============================================

  describe('Message Events', () => {
    it('should handle message_chunk event (transient)', () => {
      const event = AgentEventFactory.messageChunk({ content: 'Hello ' });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'message_chunk',
        content: 'Hello ',
        persistenceState: 'transient',
      });
    });

    it('should handle complete message event with all fields', () => {
      const event = AgentEventFactory.message({
        messageId: 'msg_123',
        role: 'assistant',
        content: 'Full response here.',
        stopReason: 'end_turn',
        tokenUsage: { inputTokens: 100, outputTokens: 200 },
        model: 'claude-sonnet-4-5-20250929',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      const msg = receivedEvents[0];
      expect(isMessageEvent(msg!)).toBe(true);
      if (isMessageEvent(msg!)) {
        expect(msg.messageId).toBe('msg_123');
        expect(msg.role).toBe('assistant');
        expect(msg.stopReason).toBe('end_turn');
        expect(msg.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 200 });
        expect(msg.model).toBe('claude-sonnet-4-5-20250929');
      }
    });

    it('should handle all stopReason values', () => {
      const stopReasons = [
        'end_turn',
        'tool_use',
        'max_tokens',
        'stop_sequence',
      ] as const;

      stopReasons.forEach((reason) => {
        const event = AgentEventFactory.message({ stopReason: reason });
        mockSocket._trigger('agent:event', event);

        const lastEvent = receivedEvents[receivedEvents.length - 1];
        expect(isMessageEvent(lastEvent!)).toBe(true);
        if (isMessageEvent(lastEvent!)) {
          expect(lastEvent.stopReason).toBe(reason);
        }
      });
    });

    it('should handle message_partial event', () => {
      const event = AgentEventFactory.messagePartial({
        content: 'Partial content...',
        messageId: 'msg_partial_123',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'message_partial',
        content: 'Partial content...',
        persistenceState: 'transient',
      });
    });
  });

  // ============================================
  // Tool Events (4 tests)
  // ============================================

  describe('Tool Events', () => {
    it('should handle tool_use event', () => {
      const event = AgentEventFactory.toolUse({
        toolName: 'list_customers',
        args: { filter: 'active' },
        toolUseId: 'toolu_123',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      const toolEvent = receivedEvents[0];
      expect(isToolUseEvent(toolEvent!)).toBe(true);
      if (isToolUseEvent(toolEvent!)) {
        expect(toolEvent.toolName).toBe('list_customers');
        expect(toolEvent.args).toEqual({ filter: 'active' });
        expect(toolEvent.toolUseId).toBe('toolu_123');
      }
    });

    it('should handle tool_result with success', () => {
      const event = AgentEventFactory.toolResult({
        toolName: 'list_customers',
        result: { customers: [{ id: '1', name: 'Acme' }] },
        success: true,
        durationMs: 150,
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'tool_result',
        success: true,
        durationMs: 150,
      });
    });

    it('should handle tool_result with failure', () => {
      const event = AgentEventFactory.toolResult({
        success: false,
        error: 'Database connection failed',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'tool_result',
        success: false,
        error: 'Database connection failed',
      });
    });

    it('should correlate tool_use and tool_result via toolUseId', () => {
      const toolUseId = 'toolu_correlation_test';

      mockSocket._trigger('agent:event', AgentEventFactory.toolUse({ toolUseId }));
      mockSocket._trigger('agent:event', AgentEventFactory.toolResult({ toolUseId }));

      expect(receivedEvents).toHaveLength(2);
      expect((receivedEvents[0] as { toolUseId?: string }).toolUseId).toBe(toolUseId);
      expect((receivedEvents[1] as { toolUseId?: string }).toolUseId).toBe(toolUseId);
    });
  });

  // ============================================
  // Approval Events (3 tests)
  // ============================================

  describe('Approval Events', () => {
    it('should handle approval_requested with all fields', () => {
      const event = AgentEventFactory.approvalRequested({
        approvalId: 'approval-123',
        toolName: 'customer_create',
        args: { name: 'New Customer' },
        changeSummary: 'Create new customer',
        priority: 'high',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      const approvalEvent = receivedEvents[0];
      expect(isApprovalRequestedEvent(approvalEvent!)).toBe(true);
      if (isApprovalRequestedEvent(approvalEvent!)) {
        expect(approvalEvent.approvalId).toBe('approval-123');
        expect(approvalEvent.toolName).toBe('customer_create');
        expect(approvalEvent.priority).toBe('high');
        expect(approvalEvent.changeSummary).toBe('Create new customer');
      }
    });

    it('should handle all priority levels', () => {
      const priorities = ['low', 'medium', 'high'] as const;

      priorities.forEach((priority) => {
        const event = AgentEventFactory.approvalRequested({ priority });
        mockSocket._trigger('agent:event', event);

        const lastEvent = receivedEvents[receivedEvents.length - 1];
        expect(isApprovalRequestedEvent(lastEvent!)).toBe(true);
        if (isApprovalRequestedEvent(lastEvent!)) {
          expect(lastEvent.priority).toBe(priority);
        }
      });
    });

    it('should handle approval_resolved with decision', () => {
      const decisions = ['approved', 'rejected'] as const;

      decisions.forEach((decision) => {
        const event = AgentEventFactory.approvalResolved({
          approvalId: 'approval-123',
          decision,
          reason: decision === 'rejected' ? 'Not authorized' : undefined,
        });
        mockSocket._trigger('agent:event', event);

        const lastEvent = receivedEvents[receivedEvents.length - 1];
        expect(lastEvent).toMatchObject({
          type: 'approval_resolved',
          decision,
          approvalId: 'approval-123',
        });
      });
    });
  });

  // ============================================
  // Special Events (4 tests)
  // ============================================

  describe('Special Events', () => {
    it('should handle user_message_confirmed with sequenceNumber', () => {
      const event = AgentEventFactory.userMessageConfirmed({
        messageId: 'msg-user-123',
        userId: 'user-456',
        content: 'Hello agent!',
        sequenceNumber: 5,
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'user_message_confirmed',
        sequenceNumber: 5,
        persistenceState: 'persisted',
        content: 'Hello agent!',
      });
    });

    it('should handle turn_paused event (SDK 0.71)', () => {
      const event = AgentEventFactory.turnPaused({
        messageId: 'msg-paused',
        content: 'Partial content...',
        reason: 'Long operation',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'turn_paused',
        reason: 'Long operation',
        content: 'Partial content...',
      });
    });

    it('should handle content_refused event (SDK 0.71)', () => {
      const event = AgentEventFactory.contentRefused({
        messageId: 'msg-refused',
        reason: 'Policy violation',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'content_refused',
        reason: 'Policy violation',
      });
    });

    it('should handle error event', () => {
      const event = AgentEventFactory.error({
        error: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents).toHaveLength(1);
      const errorEvent = receivedEvents[0];
      expect(isErrorEvent(errorEvent!)).toBe(true);
      if (isErrorEvent(errorEvent!)) {
        expect(errorEvent.error).toBe('Something went wrong');
        expect(errorEvent.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});

// ============================================
// Event Sourcing Contract Tests
// ============================================

describe('Event Sourcing Contract', () => {
  let mockSocket: MockSocket;
  let receivedEvents: AgentEvent[];
  let service: SocketService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSocketService();
    AgentEventFactory.resetSequence();

    receivedEvents = [];
    mockSocket = createMockSocket({ connected: true });
    setMockSocket(mockSocket);

    service = new SocketService({
      onAgentEvent: (event) => receivedEvents.push(event),
    });
    service.connect();
    mockSocket._trigger('connect');
  });

  afterEach(() => {
    resetTestEnvironment();
  });

  // ============================================
  // Sequence Number Tests (3 tests)
  // ============================================

  describe('Sequence Number Handling', () => {
    it('should receive events with incrementing sequenceNumber', () => {
      const events = AgentEventFactory.sequence(
        ['session_start', 'message', 'complete'],
        1
      );

      events.forEach((e) => mockSocket._trigger('agent:event', e));

      expect(receivedEvents).toHaveLength(3);

      // Check sequence numbers are incrementing
      const seqNumbers = receivedEvents
        .filter((e) => e.persistenceState !== 'transient')
        .map((e) => e.sequenceNumber)
        .filter((n): n is number => n !== undefined);

      for (let i = 1; i < seqNumbers.length; i++) {
        expect(seqNumbers[i]).toBeGreaterThan(seqNumbers[i - 1]!);
      }
    });

    it('should use sequenceNumber for sorting, NOT timestamp', () => {
      // Events arrive out of order
      const event3 = AgentEventFactory.message({ sequenceNumber: 3 });
      const event1 = AgentEventFactory.sessionStart({ sequenceNumber: 1 });
      const event2 = AgentEventFactory.complete({ sequenceNumber: 2 });

      mockSocket._trigger('agent:event', event3);
      mockSocket._trigger('agent:event', event1);
      mockSocket._trigger('agent:event', event2);

      // Sort by sequenceNumber (as frontend should do)
      const sorted = [...receivedEvents].sort(
        (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0)
      );

      expect(sorted[0]?.sequenceNumber).toBe(1);
      expect(sorted[1]?.sequenceNumber).toBe(2);
      expect(sorted[2]?.sequenceNumber).toBe(3);
    });

    it('should handle transient events without sequenceNumber', () => {
      const transientEvent = AgentEventFactory.messageChunk({
        content: 'chunk',
      });

      mockSocket._trigger('agent:event', transientEvent);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]?.persistenceState).toBe('transient');
      // Transient events may or may not have sequenceNumber
    });
  });

  // ============================================
  // Persistence State Tests (4 tests)
  // ============================================

  describe('Persistence State', () => {
    it('should receive events with persistenceState: persisted', () => {
      const event = AgentEventFactory.message({ persistenceState: 'persisted' });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents[0]?.persistenceState).toBe('persisted');
    });

    it('should receive events with persistenceState: queued', () => {
      const event = AgentEventFactory.message({ persistenceState: 'queued' });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents[0]?.persistenceState).toBe('queued');
    });

    it('should receive events with persistenceState: transient', () => {
      const event = AgentEventFactory.messageChunk({
        persistenceState: 'transient',
      });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents[0]?.persistenceState).toBe('transient');
    });

    it('should receive events with persistenceState: failed', () => {
      const event = AgentEventFactory.message({ persistenceState: 'failed' });

      mockSocket._trigger('agent:event', event);

      expect(receivedEvents[0]?.persistenceState).toBe('failed');
    });
  });

  // ============================================
  // Correlation Tests (2 tests)
  // ============================================

  describe('Event Correlation', () => {
    it('should link events via correlationId', () => {
      const correlationId = 'corr-123';
      const toolUse = AgentEventFactory.toolUse();
      const toolResult = AgentEventFactory.toolResult();

      // Manually add correlationId
      (toolUse as { correlationId?: string }).correlationId = correlationId;
      (toolResult as { correlationId?: string }).correlationId = correlationId;

      mockSocket._trigger('agent:event', toolUse);
      mockSocket._trigger('agent:event', toolResult);

      expect(
        (receivedEvents[0] as { correlationId?: string }).correlationId
      ).toBe(correlationId);
      expect(
        (receivedEvents[1] as { correlationId?: string }).correlationId
      ).toBe(correlationId);
    });

    it('should correlate approval_requested -> approval_resolved via approvalId', () => {
      const approvalId = 'approval-corr-test';

      mockSocket._trigger(
        'agent:event',
        AgentEventFactory.approvalRequested({ approvalId })
      );
      mockSocket._trigger(
        'agent:event',
        AgentEventFactory.approvalResolved({ approvalId })
      );

      expect(receivedEvents).toHaveLength(2);
      expect((receivedEvents[0] as { approvalId: string }).approvalId).toBe(
        approvalId
      );
      expect((receivedEvents[1] as { approvalId: string }).approvalId).toBe(
        approvalId
      );
    });
  });
});

// ============================================
// Agent Error Event Tests
// ============================================

describe('Agent Error Handling', () => {
  let mockSocket: MockSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSocketService();
    mockSocket = createMockSocket({ connected: true });
    setMockSocket(mockSocket);
  });

  afterEach(() => {
    resetTestEnvironment();
  });

  it('should call onAgentError when agent:error fires', () => {
    const onAgentError = vi.fn();
    const consoleSpy = createConsoleSpy();

    const service = new SocketService({ onAgentError });
    service.connect();
    mockSocket._trigger('connect');

    mockSocket._trigger('agent:error', {
      error: 'Agent failed',
      sessionId: 'session-123',
      code: 'AGENT_ERROR',
    });

    expect(onAgentError).toHaveBeenCalledWith({
      error: 'Agent failed',
      sessionId: 'session-123',
      code: 'AGENT_ERROR',
    });
    expect(consoleSpy.error).toHaveBeenCalled();

    consoleSpy.restore();
  });

  it('should handle error event with code', () => {
    const receivedEvents: AgentEvent[] = [];
    const service = new SocketService({
      onAgentEvent: (e) => receivedEvents.push(e),
    });
    service.connect();
    mockSocket._trigger('connect');

    mockSocket._trigger(
      'agent:event',
      AgentEventFactory.error({
        error: 'Internal error',
        code: 'INTERNAL_ERROR',
      })
    );

    expect(receivedEvents).toHaveLength(1);
    const errorEvent = receivedEvents[0];
    expect(isErrorEvent(errorEvent!)).toBe(true);
    if (isErrorEvent(errorEvent!)) {
      expect(errorEvent.code).toBe('INTERNAL_ERROR');
    }
  });
});

// ============================================
// Session Event Tests
// ============================================

describe('Session Events', () => {
  let mockSocket: MockSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSocketService();
    mockSocket = createMockSocket({ connected: true });
    setMockSocket(mockSocket);
  });

  afterEach(() => {
    resetTestEnvironment();
  });

  it('should call onSessionReady when session:ready fires', () => {
    const onSessionReady = vi.fn();
    const service = new SocketService({ onSessionReady });
    service.connect();
    mockSocket._trigger('connect');

    mockSocket._trigger('session:ready', {
      sessionId: 'session-123',
      timestamp: new Date().toISOString(),
    });

    expect(onSessionReady).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
      })
    );
  });

  it('should call onSessionJoined when session:joined fires', () => {
    const onSessionJoined = vi.fn();
    const service = new SocketService({ onSessionJoined });
    service.connect();
    mockSocket._trigger('connect');

    mockSocket._trigger('session:joined', { sessionId: 'session-123' });

    expect(onSessionJoined).toHaveBeenCalledWith({ sessionId: 'session-123' });
  });

  it('should call onSessionLeft when session:left fires', () => {
    const onSessionLeft = vi.fn();
    const service = new SocketService({ onSessionLeft });
    service.connect();
    mockSocket._trigger('connect');

    mockSocket._trigger('session:left', { sessionId: 'session-123' });

    expect(onSessionLeft).toHaveBeenCalledWith({ sessionId: 'session-123' });
  });

  it('should call onSessionError when session:error fires', () => {
    const onSessionError = vi.fn();
    const consoleSpy = createConsoleSpy();
    const service = new SocketService({ onSessionError });
    service.connect();
    mockSocket._trigger('connect');

    mockSocket._trigger('session:error', {
      error: 'Session not found',
      sessionId: 'session-123',
    });

    expect(onSessionError).toHaveBeenCalledWith({
      error: 'Session not found',
      sessionId: 'session-123',
    });
    expect(consoleSpy.error).toHaveBeenCalled();

    consoleSpy.restore();
  });
});
