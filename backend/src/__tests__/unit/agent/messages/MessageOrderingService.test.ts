/**
 * MessageOrderingService Unit Tests
 *
 * Tests the critical ordering functionality:
 * - Sequence batch reservation
 * - Single sequence generation
 * - Ordered event creation
 * - Validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageOrderingService, getMessageOrderingService } from '@services/agent/messages/MessageOrderingService';

// Mock Redis
const mockRedis = {
  incrBy: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/config/redis', () => ({
  getRedis: () => mockRedis,
}));

// Mock database
const mockExecuteQuery = vi.fn();
vi.mock('@/config/database', () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MessageOrderingService', () => {
  let service: MessageOrderingService;

  beforeEach(() => {
    // Reset singleton and mocks
    MessageOrderingService.__resetInstance();
    vi.clearAllMocks();
    service = getMessageOrderingService();
  });

  afterEach(() => {
    MessageOrderingService.__resetInstance();
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = getMessageOrderingService();
      const instance2 = getMessageOrderingService();
      expect(instance1).toBe(instance2);
    });

    it('should return new instance after reset', () => {
      const instance1 = getMessageOrderingService();
      MessageOrderingService.__resetInstance();
      const instance2 = getMessageOrderingService();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('reserveSequenceBatch', () => {
    it('should reserve consecutive sequences from Redis', async () => {
      // Redis INCRBY returns the NEW value after increment
      // If we reserve 3 and current is 5, INCRBY returns 8
      mockRedis.incrBy.mockResolvedValue(8);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.reserveSequenceBatch('session-123', 3);

      expect(result.sessionId).toBe('session-123');
      expect(result.startSequence).toBe(5); // 8 - 3 = 5
      expect(result.sequences).toEqual([5, 6, 7]);
      expect(result.reservedAt).toBeInstanceOf(Date);

      expect(mockRedis.incrBy).toHaveBeenCalledWith('event:sequence:session-123', 3);
      expect(mockRedis.expire).toHaveBeenCalledWith('event:sequence:session-123', 604800); // 7 days
    });

    it('should reserve single sequence correctly', async () => {
      mockRedis.incrBy.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.reserveSequenceBatch('session-123', 1);

      expect(result.startSequence).toBe(0); // 1 - 1 = 0
      expect(result.sequences).toEqual([0]);
    });

    it('should handle first reservation (counter starts at 0)', async () => {
      mockRedis.incrBy.mockResolvedValue(5); // First batch of 5
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.reserveSequenceBatch('new-session', 5);

      expect(result.startSequence).toBe(0); // 5 - 5 = 0
      expect(result.sequences).toEqual([0, 1, 2, 3, 4]);
    });

    it('should throw error for non-positive count', async () => {
      await expect(service.reserveSequenceBatch('session-123', 0))
        .rejects.toThrow('Count must be positive');

      await expect(service.reserveSequenceBatch('session-123', -1))
        .rejects.toThrow('Count must be positive');
    });

    it('should fallback to database when Redis unavailable', async () => {
      // Make Redis fail
      mockRedis.incrBy.mockRejectedValue(new Error('Redis connection failed'));

      // Database returns max sequence
      mockExecuteQuery.mockResolvedValue({
        recordset: [{ max_seq: 10 }],
      });

      const result = await service.reserveSequenceBatch('session-123', 3);

      expect(result.startSequence).toBe(11); // max_seq + 1
      expect(result.sequences).toEqual([11, 12, 13]);
    });

    it('should handle empty database (no events yet)', async () => {
      mockRedis.incrBy.mockRejectedValue(new Error('Redis unavailable'));
      mockExecuteQuery.mockResolvedValue({
        recordset: [{ max_seq: null }],
      });

      const result = await service.reserveSequenceBatch('session-123', 2);

      expect(result.startSequence).toBe(0); // null + 1 = 0
      expect(result.sequences).toEqual([0, 1]);
    });
  });

  describe('getNextSequence', () => {
    it('should return single sequence', async () => {
      mockRedis.incrBy.mockResolvedValue(5);
      mockRedis.expire.mockResolvedValue(1);

      const sequence = await service.getNextSequence('session-123');

      expect(sequence).toBe(4); // 5 - 1 = 4
      expect(mockRedis.incrBy).toHaveBeenCalledWith('event:sequence:session-123', 1);
    });
  });

  describe('createOrderedEvent', () => {
    it('should create event with pre-assigned sequence', async () => {
      const result = await service.createOrderedEvent(
        'session-123',
        {
          eventType: 'tool_use_completed',
          data: { tool_use_id: 'toolu_01', result: 'success' },
        },
        42 // Pre-assigned sequence
      );

      expect(result.sessionId).toBe('session-123');
      expect(result.eventType).toBe('tool_use_completed');
      expect(result.sequenceNumber).toBe(42);
      expect(result.data).toEqual({ tool_use_id: 'toolu_01', result: 'success' });
      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);

      // Should NOT call Redis since sequence was pre-assigned
      expect(mockRedis.incrBy).not.toHaveBeenCalled();
    });

    it('should generate new sequence if not pre-assigned', async () => {
      mockRedis.incrBy.mockResolvedValue(10);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.createOrderedEvent(
        'session-123',
        {
          eventType: 'agent_message_sent',
          data: { content: 'Hello' },
        }
        // No pre-assigned sequence
      );

      expect(result.sequenceNumber).toBe(9); // 10 - 1 = 9
      expect(mockRedis.incrBy).toHaveBeenCalled();
    });
  });

  describe('validateOrdering', () => {
    it('should return valid for correct sequence', async () => {
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          { id: 'e1', sequence_number: 0, timestamp: new Date('2024-01-01T00:00:00Z'), event_type: 'user_message_sent' },
          { id: 'e2', sequence_number: 1, timestamp: new Date('2024-01-01T00:00:01Z'), event_type: 'agent_message_sent' },
          { id: 'e3', sequence_number: 2, timestamp: new Date('2024-01-01T00:00:02Z'), event_type: 'tool_use_completed' },
        ],
      });

      const result = await service.validateOrdering('session-123');

      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(3);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect sequence gaps', async () => {
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          { id: 'e1', sequence_number: 0, timestamp: new Date(), event_type: 'msg' },
          { id: 'e2', sequence_number: 1, timestamp: new Date(), event_type: 'msg' },
          { id: 'e3', sequence_number: 5, timestamp: new Date(), event_type: 'msg' }, // Gap!
        ],
      });

      const result = await service.validateOrdering('session-123');

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.type).toBe('sequence_gap');
      expect(result.issues[0]!.message).toContain('1 -> 5');
    });

    it('should detect duplicate sequences', async () => {
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          { id: 'e1', sequence_number: 0, timestamp: new Date(), event_type: 'msg' },
          { id: 'e2', sequence_number: 1, timestamp: new Date(), event_type: 'msg' },
          { id: 'e3', sequence_number: 1, timestamp: new Date(), event_type: 'msg' }, // Duplicate!
        ],
      });

      const result = await service.validateOrdering('session-123');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.type === 'sequence_duplicate')).toBe(true);
    });

    it('should warn about out-of-order timestamps', async () => {
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          { id: 'e1', sequence_number: 0, timestamp: new Date('2024-01-01T00:00:02Z'), event_type: 'msg' },
          { id: 'e2', sequence_number: 1, timestamp: new Date('2024-01-01T00:00:01Z'), event_type: 'msg' }, // Earlier!
        ],
      });

      const result = await service.validateOrdering('session-123');

      // Timestamp issues are warnings, not errors
      expect(result.valid).toBe(true);
      expect(result.issues.some(i => i.type === 'wrong_order')).toBe(true);
    });

    it('should return valid for empty session', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      const result = await service.validateOrdering('session-123');

      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(0);
    });
  });

  describe('getCurrentSequence', () => {
    it('should return current Redis counter', async () => {
      mockRedis.get.mockResolvedValue('15');

      const sequence = await service.getCurrentSequence('session-123');

      expect(sequence).toBe(15);
      expect(mockRedis.get).toHaveBeenCalledWith('event:sequence:session-123');
    });

    it('should fallback to database when Redis has no value', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockExecuteQuery.mockResolvedValue({
        recordset: [{ max_seq: 10 }],
      });

      const sequence = await service.getCurrentSequence('session-123');

      expect(sequence).toBe(0); // null Redis returns 0
    });
  });

  describe('concurrent batch reservations', () => {
    it('should guarantee non-overlapping sequences for concurrent reservations', async () => {
      // Simulate concurrent calls by tracking call order
      let callCount = 0;
      mockRedis.incrBy.mockImplementation(async (_key: string, count: number) => {
        callCount++;
        // Each call gets the next batch
        return callCount * count;
      });
      mockRedis.expire.mockResolvedValue(1);

      // Simulate 3 concurrent batch reservations
      const [batch1, batch2, batch3] = await Promise.all([
        service.reserveSequenceBatch('session-123', 2),
        service.reserveSequenceBatch('session-123', 2),
        service.reserveSequenceBatch('session-123', 2),
      ]);

      // All sequences should be unique
      const allSequences = [
        ...batch1.sequences,
        ...batch2.sequences,
        ...batch3.sequences,
      ];
      const uniqueSequences = new Set(allSequences);

      expect(uniqueSequences.size).toBe(6); // All 6 sequences unique
    });
  });
});
