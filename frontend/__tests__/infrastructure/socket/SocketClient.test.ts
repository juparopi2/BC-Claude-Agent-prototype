/**
 * SocketClient Tests
 *
 * TDD tests for the new infrastructure SocketClient.
 * Tests written BEFORE implementation following Sprint 1 plan.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMockSocket,
  setMockSocket,
  resetMockIo,
  type MockSocket,
} from '../../mocks/socketMock';
import { AgentEventFactory } from '../../fixtures/AgentEventFactory';

// Mock socket.io-client
vi.mock('socket.io-client', async () => {
  const { mockIo } = await import('../../mocks/socketMock');
  return {
    io: mockIo,
  };
});

// Import after mock setup
import { SocketClient, resetSocketClient } from '@/src/infrastructure/socket/SocketClient';

describe('SocketClient', () => {
  let mockSocket: MockSocket;
  let client: SocketClient;

  beforeEach(() => {
    resetSocketClient();
    resetMockIo();
    AgentEventFactory.resetSequence();
    mockSocket = createMockSocket();
    setMockSocket(mockSocket);
    client = new SocketClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('connect()', () => {
    it('connects with correct options', async () => {
      const connectPromise = client.connect({
        url: 'http://localhost:3002',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
      });

      // Simulate connection
      mockSocket.connected = true;
      mockSocket._trigger('connect');

      await connectPromise;

      expect(client.isConnected).toBe(true);
    });

    it('resolves when connection succeeds', async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });

      // Simulate connection
      mockSocket.connected = true;
      mockSocket._trigger('connect');

      await expect(connectPromise).resolves.toBeUndefined();
    });

    it('rejects on connection error', async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });

      // Simulate connection error
      mockSocket._trigger('connect_error', new Error('Connection refused'));

      await expect(connectPromise).rejects.toThrow('Connection refused');
    });

    it('notifies connection state changes via callback', async () => {
      const connectionStates: boolean[] = [];
      client.onConnectionChange((connected) => connectionStates.push(connected));

      const connectPromise = client.connect({ url: 'http://localhost:3002' });

      mockSocket.connected = true;
      mockSocket._trigger('connect');

      await connectPromise;

      expect(connectionStates).toContain(true);
    });
  });

  describe('joinSession()', () => {
    beforeEach(async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });
      mockSocket.connected = true;
      mockSocket._trigger('connect');
      await connectPromise;
    });

    it('returns Promise that resolves on session:ready', async () => {
      const joinPromise = client.joinSession('session-123');

      // Verify emit was called
      expect(mockSocket.emit).toHaveBeenCalledWith('session:join', { sessionId: 'session-123' });

      // Simulate session:ready from server
      mockSocket._trigger('session:ready', { sessionId: 'session-123' });

      await expect(joinPromise).resolves.toBeUndefined();
    });

    it('rejects on timeout (5s default)', async () => {
      vi.useFakeTimers();

      const joinPromise = client.joinSession('session-123');

      // Advance time past timeout
      vi.advanceTimersByTime(5100);

      await expect(joinPromise).rejects.toThrow('Join timeout');

      vi.useRealTimers();
    });

    it('respects custom timeout option', async () => {
      vi.useFakeTimers();

      const joinPromise = client.joinSession('session-123', { timeout: 1000 });

      // Advance time past custom timeout
      vi.advanceTimersByTime(1100);

      await expect(joinPromise).rejects.toThrow('Join timeout');

      vi.useRealTimers();
    });

    it('leaves previous session if different', async () => {
      // Join first session
      const firstJoin = client.joinSession('session-1');
      mockSocket._trigger('session:ready', { sessionId: 'session-1' });
      await firstJoin;

      // Join second session
      const secondJoin = client.joinSession('session-2');

      // Verify it left first session
      expect(mockSocket.emit).toHaveBeenCalledWith('session:leave', { sessionId: 'session-1' });

      mockSocket._trigger('session:ready', { sessionId: 'session-2' });
      await secondJoin;
    });

    it('does not leave if joining same session', async () => {
      const firstJoin = client.joinSession('session-1');
      mockSocket._trigger('session:ready', { sessionId: 'session-1' });
      await firstJoin;

      mockSocket.emit.mockClear();

      const secondJoin = client.joinSession('session-1');
      mockSocket._trigger('session:ready', { sessionId: 'session-1' });
      await secondJoin;

      // Should not have called leave
      const leaveCalls = mockSocket.emit.mock.calls.filter(
        (call) => call[0] === 'session:leave'
      );
      expect(leaveCalls).toHaveLength(0);
    });
  });

  describe('sendMessage()', () => {
    beforeEach(async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });
      mockSocket.connected = true;
      mockSocket._trigger('connect');
      await connectPromise;
    });

    it('emits chat:message event', () => {
      const messageData = {
        message: 'Hello',
        sessionId: 'session-123',
        userId: 'user-456',
      };

      client.sendMessage(messageData);

      expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', messageData);
    });

    it('queues message if not connected', () => {
      mockSocket.connected = false;

      const messageData = {
        message: 'Hello',
        sessionId: 'session-123',
        userId: 'user-456',
      };

      client.sendMessage(messageData);

      // Should not have emitted yet
      const messageCalls = mockSocket.emit.mock.calls.filter(
        (call) => call[0] === 'chat:message'
      );
      expect(messageCalls).toHaveLength(0);

      // Should have queued
      expect(client.hasPendingMessages).toBe(true);
    });

    it('flushes pending messages on reconnect', async () => {
      mockSocket.connected = false;

      const messageData = {
        message: 'Hello',
        sessionId: 'session-123',
        userId: 'user-456',
      };

      client.sendMessage(messageData);

      // Reconnect
      mockSocket.connected = true;
      mockSocket._trigger('connect');

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have emitted the queued message
      expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', messageData);
      expect(client.hasPendingMessages).toBe(false);
    });
  });

  describe('onAgentEvent()', () => {
    beforeEach(async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });
      mockSocket.connected = true;
      mockSocket._trigger('connect');
      await connectPromise;
    });

    it('subscribes to agent events', () => {
      const events: unknown[] = [];
      client.onAgentEvent((event) => events.push(event));

      const messageEvent = AgentEventFactory.message();
      mockSocket._trigger('agent:event', messageEvent);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(messageEvent);
    });

    it('returns unsubscribe function', () => {
      const events: unknown[] = [];
      const unsubscribe = client.onAgentEvent((event) => events.push(event));

      // First event should be captured
      mockSocket._trigger('agent:event', AgentEventFactory.message());
      expect(events).toHaveLength(1);

      // Unsubscribe
      unsubscribe();

      // Second event should NOT be captured
      mockSocket._trigger('agent:event', AgentEventFactory.message());
      expect(events).toHaveLength(1); // Still 1
    });

    it('supports multiple subscribers', () => {
      const events1: unknown[] = [];
      const events2: unknown[] = [];

      client.onAgentEvent((event) => events1.push(event));
      client.onAgentEvent((event) => events2.push(event));

      const messageEvent = AgentEventFactory.message();
      mockSocket._trigger('agent:event', messageEvent);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });
  });

  describe('stopAgent()', () => {
    beforeEach(async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });
      mockSocket.connected = true;
      mockSocket._trigger('connect');
      await connectPromise;
    });

    it('emits chat:stop event', () => {
      client.stopAgent({ sessionId: 'session-123' });

      expect(mockSocket.emit).toHaveBeenCalledWith('chat:stop', { sessionId: 'session-123' });
    });
  });

  describe('respondToApproval()', () => {
    beforeEach(async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });
      mockSocket.connected = true;
      mockSocket._trigger('connect');
      await connectPromise;
    });

    it('emits approval:response event', () => {
      const approvalData = {
        sessionId: 'session-123',
        approvalId: 'approval-456',
        approved: true,
      };

      client.respondToApproval(approvalData);

      expect(mockSocket.emit).toHaveBeenCalledWith('approval:response', approvalData);
    });
  });

  describe('disconnect()', () => {
    beforeEach(async () => {
      const connectPromise = client.connect({ url: 'http://localhost:3002' });
      mockSocket.connected = true;
      mockSocket._trigger('connect');
      await connectPromise;
    });

    it('disconnects and clears state', () => {
      client.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(client.isConnected).toBe(false);
    });

    it('leaves current session before disconnecting', async () => {
      const joinPromise = client.joinSession('session-123');
      mockSocket._trigger('session:ready', { sessionId: 'session-123' });
      await joinPromise;

      client.disconnect();

      expect(mockSocket.emit).toHaveBeenCalledWith('session:leave', { sessionId: 'session-123' });
    });
  });
});
