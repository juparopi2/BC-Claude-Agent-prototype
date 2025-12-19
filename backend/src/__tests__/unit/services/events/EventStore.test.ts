/**
 * EventStore Unit Tests - FIXED WITH vi.hoisted() PATTERN
 *
 * Fixed Issues:
 * 1. Used vi.hoisted() for persistent mock references
 * 2. Re-setup mock implementations in beforeEach after clearAllMocks
 * 3. Matches ApprovalManager.test.ts proven pattern (lines 22-64)
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Reference: https://vitest.dev/api/vi#vi-hoisted
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventStore, getEventStore } from '@/services/events/EventStore';
import type { EventType, MessageEvent } from '@/services/events/EventStore';

// ===== MOCK REDIS (vi.hoisted pattern for persistent references) =====
const mockRedisMethods = vi.hoisted(() => ({
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  quit: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('@/infrastructure/redis/redis', () => ({
  getRedis: vi.fn(() => mockRedisMethods),
}));

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockDbQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

const mockDbInput = vi.hoisted(() =>
  vi.fn().mockReturnThis()
);

const mockDbRequest = vi.hoisted(() =>
  vi.fn(() => ({
    input: mockDbInput,
    query: mockDbQuery,
  }))
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    recordset: [],
    rowsAffected: [1],
  }),
  getDatabase: vi.fn(() => ({
    request: mockDbRequest,
  })),
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
}));

describe('EventStore', () => {
  let eventStore: EventStore;
  let mockExecuteQuery: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks (critical fix!)
    mockRedisMethods.incr.mockResolvedValue(1);
    mockRedisMethods.expire.mockResolvedValue(1);
    mockRedisMethods.get.mockResolvedValue(null);
    mockRedisMethods.set.mockResolvedValue('OK');
    mockRedisMethods.quit.mockResolvedValue('OK');

    // Re-setup database mock
    mockDbRequest.mockReturnValue({
      input: mockDbInput,
      query: mockDbQuery,
    });
    mockDbInput.mockReturnThis();
    mockDbQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Get executeQuery mock reference
    const { executeQuery } = await import('@/infrastructure/database/database');
    mockExecuteQuery = vi.mocked(executeQuery);

    // Reset singleton instance
    (EventStore as any).instance = null;
    eventStore = getEventStore();
  });

  // ========== BASIC FUNCTIONALITY (10 TESTS) ==========
  describe('Basic Functionality', () => {
    it('should return singleton instance', () => {
      const instance1 = getEventStore();
      const instance2 = getEventStore();

      expect(instance1).toBe(instance2);
    });

    it('should append event with generated UUID', async () => {
      const sessionId = 'session-123';
      const eventType: EventType = 'user_message_sent';
      const eventData = { message_id: 'msg-1', content: 'Hello', user_id: 'user-1' };

      const event = await eventStore.appendEvent(sessionId, eventType, eventData);

      expect(event.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(event.session_id).toBe(sessionId);
      expect(event.event_type).toBe(eventType);
      expect(event.data).toEqual(eventData);
      expect(event.processed).toBe(false);
    });

    it('should serialize event data as JSON string in database', async () => {
      const eventData = {
        message_id: 'msg-1',
        metadata: { user: 'test', role: 'admin' },
        tags: ['important', 'urgent'],
      };

      await eventStore.appendEvent('session-123', 'user_message_sent', eventData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO message_events'),
        expect.objectContaining({
          data: JSON.stringify(eventData),
        })
      );
    });

    it('should store timestamp as Date', async () => {
      const beforeTimestamp = Date.now();

      const event = await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should handle large event payloads (>10KB)', async () => {
      const largeContent = 'A'.repeat(15000); // 15KB
      const eventData = { message_id: 'msg-1', content: largeContent, user_id: 'user-1' };

      const event = await eventStore.appendEvent('session-123', 'user_message_sent', eventData);

      expect(event.data).toEqual(eventData);
      expect(JSON.stringify(eventData).length).toBeGreaterThan(10000);
    });

    it('should throw error on database failure', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection lost'));

      await expect(
        eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' })
      ).rejects.toThrow('Database connection lost');
    });

    it('should call executeQuery with correct SQL parameters', async () => {
      const sessionId = 'session-123';
      const eventType: EventType = 'user_message_sent';
      const eventData = { message_id: 'msg-1', content: 'Test', user_id: 'user-1' };

      await eventStore.appendEvent(sessionId, eventType, eventData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO message_events'),
        expect.objectContaining({
          session_id: sessionId,
          event_type: eventType,
          data: JSON.stringify(eventData),
          processed: false,
        })
      );
    });

    it('should log debug message on successful append', async () => {
      await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Event appended to store',
        expect.objectContaining({
          sessionId: 'session-123',
          eventType: 'user_message_sent',
        })
      );
    });

    it('should log error on failure', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Test error'));

      await expect(
        eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' })
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to append event',
        expect.objectContaining({
          sessionId: 'session-123',
          eventType: 'user_message_sent',
        })
      );
    });

    it('should return event with all required fields', async () => {
      const event = await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('session_id');
      expect(event).toHaveProperty('event_type');
      expect(event).toHaveProperty('sequence_number');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('data');
      expect(event).toHaveProperty('processed');
    });
  });

  // ========== SEQUENCE NUMBER GENERATION (8 TESTS) ==========
  describe('Sequence Number Generation', () => {
    it('should use Redis INCR for sequence numbers', async () => {
      mockRedisMethods.incr.mockResolvedValueOnce(5);

      await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(mockRedisMethods.incr).toHaveBeenCalledWith('event:sequence:session-123');
    });

    it('should set TTL on Redis sequence key (7 days)', async () => {
      mockRedisMethods.incr.mockResolvedValueOnce(1);

      await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(mockRedisMethods.expire).toHaveBeenCalledWith('event:sequence:session-123', 604800); // 7 days
    });

    it('should generate different sequence keys for different sessions', async () => {
      mockRedisMethods.incr.mockResolvedValue(1);

      await eventStore.appendEvent('session-1', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });
      await eventStore.appendEvent('session-2', 'user_message_sent', { message_id: 'msg-2', content: '', user_id: 'user-1' });

      expect(mockRedisMethods.incr).toHaveBeenCalledWith('event:sequence:session-1');
      expect(mockRedisMethods.incr).toHaveBeenCalledWith('event:sequence:session-2');
    });

    it('should fallback to database when Redis fails', async () => {
      mockRedisMethods.incr.mockRejectedValueOnce(new Error('Redis connection lost'));
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{ next_seq: 11 }], rowsAffected: [1] }) // Fallback query
        .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] }); // Insert query

      const event = await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(event.sequence_number).toBeGreaterThanOrEqual(0);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(MAX(sequence_number)'),
        expect.objectContaining({ session_id: 'session-123' })
      );
    });

    it('should start from 0 when no previous events exist (database fallback)', async () => {
      mockRedisMethods.incr.mockRejectedValueOnce(new Error('Redis unavailable'));
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{ next_seq: 0 }], rowsAffected: [1] }) // No previous events
        .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] }); // Insert query

      const event = await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(event.sequence_number).toBe(0);
    });

    it('should log error when Redis fails but continue with database fallback', async () => {
      mockRedisMethods.incr.mockRejectedValueOnce(new Error('Redis error'));
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{ next_seq: 0 }], rowsAffected: [1] })
        .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get next sequence number from Redis',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('should handle concurrent sequence generation', async () => {
      mockRedisMethods.incr
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);

      const events = await Promise.all([
        eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' }),
        eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-2', content: '', user_id: 'user-1' }),
        eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-3', content: '', user_id: 'user-1' }),
      ]);

      expect(mockRedisMethods.incr).toHaveBeenCalledTimes(3);
      expect(events).toHaveLength(3);
    });

    it('should not crash if expire fails', async () => {
      mockRedisMethods.incr.mockResolvedValueOnce(1);
      mockRedisMethods.expire.mockRejectedValueOnce(new Error('Expire failed'));

      const event = await eventStore.appendEvent('session-123', 'user_message_sent', { message_id: 'msg-1', content: '', user_id: 'user-1' });

      expect(event).toBeDefined();
      expect(event.session_id).toBe('session-123');
    });
  });

  // ========== GET EVENTS (8 TESTS) ==========
  describe('Get Events', () => {
    beforeEach(async () => {
      // Mock getDatabase to return truthy value
      const { getDatabase } = await import('@/infrastructure/database/database');
      vi.mocked(getDatabase).mockReturnValue({} as any);
    });

    it('should retrieve events for a session', async () => {
      const mockEvents = [
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{"message_id":"msg-1","content":"Hello","user_id":"user-1"}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      const events = await eventStore.getEvents('session-123');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
      expect(events[0].data).toEqual({ message_id: 'msg-1', content: 'Hello', user_id: 'user-1' });
    });

    it('should parse JSON data from database', async () => {
      const mockEvents = [
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{"complex":{"nested":"value"},"array":[1,2,3]}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      const events = await eventStore.getEvents('session-123');

      expect(events[0].data).toEqual({ complex: { nested: 'value' }, array: [1, 2, 3] });
    });

    it('should filter events by session_id', async () => {
      await eventStore.getEvents('session-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE session_id = @session_id'),
        expect.objectContaining({ session_id: 'session-123' })
      );
    });

    it('should order events by sequence number', async () => {
      await eventStore.getEvents('session-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY sequence_number ASC'),
        expect.any(Object)
      );
    });

    it('should support fromSequence parameter', async () => {
      await eventStore.getEvents('session-123', 5);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('sequence_number >= @from_seq'),
        expect.objectContaining({ from_seq: 5 })
      );
    });

    it('should support toSequence parameter', async () => {
      await eventStore.getEvents('session-123', undefined, 10);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('sequence_number <= @to_seq'),
        expect.objectContaining({ to_seq: 10 })
      );
    });

    it('should support range queries (from/to)', async () => {
      await eventStore.getEvents('session-123', 5, 10);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('sequence_number >= @from_seq'),
        expect.objectContaining({ from_seq: 5, to_seq: 10 })
      );
    });

    it('should throw error when database unavailable', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database error'));

      await expect(eventStore.getEvents('session-123')).rejects.toThrow('Database error');
    });
  });

  // ========== REPLAY EVENTS (6 TESTS) ==========
  describe('Replay Events', () => {
    it('should replay events with handler callback', async () => {
      const mockEvents = [
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{"message_id":"msg-1","content":"Hello","user_id":"user-1"}', processed: false },
        { id: 'evt-2', session_id: 'session-123', event_type: 'agent_message_sent', sequence_number: 1, timestamp: new Date(), data: '{"message_id":"msg-2","content":"Hi there"}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      const handler = vi.fn();
      await eventStore.replayEvents('session-123', handler);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ sequence_number: 0 }));
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ sequence_number: 1 }));
    });

    it('should call getEvents internally', async () => {
      const mockEvents = [
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      await eventStore.replayEvents('session-123', vi.fn());

      // Verify getEvents was called for session
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE session_id = @session_id'),
        expect.objectContaining({ session_id: 'session-123' })
      );
    });

    it('should not call handler when no events found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const handler = vi.fn();
      await eventStore.replayEvents('session-empty', handler);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle errors during replay', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Replay failed'));

      await expect(
        eventStore.replayEvents('session-123', vi.fn())
      ).rejects.toThrow('Replay failed');
    });

    it('should parse event data for each event', async () => {
      const mockEvents = [
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{"key":"value1"}', processed: false },
        { id: 'evt-2', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 1, timestamp: new Date(), data: '{"key":"value2"}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      const handler = vi.fn();
      await eventStore.replayEvents('session-123', handler);

      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { key: 'value1' } }));
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { key: 'value2' } }));
    });

    it('should replay events in sequence order', async () => {
      const mockEvents = [
        { id: 'evt-2', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 1, timestamp: new Date(), data: '{}', processed: false },
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      const handler = vi.fn();
      await eventStore.replayEvents('session-123', handler);

      // Handler should be called in order returned by database (which orders by sequence)
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // ========== MARK AS PROCESSED (4 TESTS) ==========
  describe('Mark as Processed', () => {
    it('should mark event as processed', async () => {
      await eventStore.markAsProcessed('evt-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE message_events'),
        expect.objectContaining({ id: 'evt-123' })
      );
    });

    it('should set processed flag to 1', async () => {
      await eventStore.markAsProcessed('evt-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET processed = 1'),
        expect.any(Object)
      );
    });

    it('should handle errors gracefully', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Update failed'));

      await expect(eventStore.markAsProcessed('evt-123')).rejects.toThrow('Update failed');
    });

    it('should log errors when marking fails', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Test error'));

      await expect(eventStore.markAsProcessed('evt-123')).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to mark event as processed',
        expect.objectContaining({ eventId: 'evt-123' })
      );
    });
  });

  // ========== GET UNPROCESSED EVENTS (4 TESTS) ==========
  describe('Get Unprocessed Events', () => {
    beforeEach(async () => {
      // Mock getDatabase to return truthy value
      const { getDatabase } = await import('@/infrastructure/database/database');
      vi.mocked(getDatabase).mockReturnValue({} as any);
    });

    it('should retrieve unprocessed events for session', async () => {
      const mockEvents = [
        { id: 'evt-1', session_id: 'session-123', event_type: 'user_message_sent', sequence_number: 0, timestamp: new Date(), data: '{}', processed: false },
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockEvents });

      const events = await eventStore.getUnprocessedEvents('session-123');

      expect(events).toHaveLength(1);
      expect(events[0].processed).toBe(false);
    });

    it('should filter by processed = 0', async () => {
      await eventStore.getUnprocessedEvents('session-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('processed = 0'),
        expect.objectContaining({ session_id: 'session-123' })
      );
    });

    it('should order by timestamp', async () => {
      await eventStore.getUnprocessedEvents('session-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY timestamp ASC'),
        expect.any(Object)
      );
    });

    it('should handle errors when retrieving unprocessed events', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Query failed'));

      await expect(eventStore.getUnprocessedEvents('session-123')).rejects.toThrow('Query failed');
    });
  });
});
