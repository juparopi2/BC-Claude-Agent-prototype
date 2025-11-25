/**
 * Unit Tests - MessageQueue Rate Limiting
 *
 * Tests for the rate limiting functionality in MessageQueue.
 * Validates multi-tenant safety (100 jobs/session/hour limit).
 *
 * Key behaviors tested:
 * - Rate limit enforcement (100 jobs/session/hour)
 * - Counter reset after 1 hour
 * - Redis failure handling (fail open)
 * - Session isolation
 * - Rate limit status reporting
 *
 * @module __tests__/unit/services/queue/MessageQueue.rateLimit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================
// Mock Dependencies using vi.hoisted
// ============================================

const { mockRedis, mockQueue, mockWorker, mockQueueEvents, mockLogger, mockExecuteQuery, mockEventStore } = vi.hoisted(() => {
  // In-memory rate limit storage for tests
  const rateLimitStore = new Map<string, { count: number; ttl: number }>();

  return {
    mockRedis: {
      incr: vi.fn(async (key: string) => {
        const existing = rateLimitStore.get(key);
        if (existing) {
          existing.count += 1;
          return existing.count;
        }
        rateLimitStore.set(key, { count: 1, ttl: 3600 });
        return 1;
      }),
      expire: vi.fn(async () => true),
      get: vi.fn(async (key: string) => {
        const existing = rateLimitStore.get(key);
        return existing ? String(existing.count) : null;
      }),
      // Event emitter methods
      on: vi.fn(),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === 'ready') {
          // Immediately trigger ready
          setTimeout(callback, 0);
        }
      }),
      quit: vi.fn(async () => 'OK'),
      // Helper to reset store between tests
      __resetStore: () => rateLimitStore.clear(),
      __getStore: () => rateLimitStore,
    },
    mockQueue: {
      add: vi.fn(async () => ({ id: 'job-123' })),
      getWaitingCount: vi.fn(async () => 0),
      getActiveCount: vi.fn(async () => 0),
      getCompletedCount: vi.fn(async () => 0),
      getFailedCount: vi.fn(async () => 0),
      getDelayedCount: vi.fn(async () => 0),
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    },
    mockWorker: {
      close: vi.fn(async () => {}),
    },
    mockQueueEvents: {
      on: vi.fn(),
      close: vi.fn(async () => {}),
    },
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockExecuteQuery: vi.fn(async () => ({ recordset: [] })),
    mockEventStore: {
      markAsProcessed: vi.fn(async () => {}),
    },
  };
});

// Mock ioredis
vi.mock('ioredis', () => ({
  Redis: vi.fn(() => mockRedis),
}));

// Mock bullmq
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueue),
  Worker: vi.fn(() => mockWorker),
  QueueEvents: vi.fn(() => mockQueueEvents),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
}));

// Mock database
vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock EventStore
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: () => mockEventStore,
  EventType: {
    USER_MESSAGE: 'user_message',
    AGENT_MESSAGE: 'agent_message',
  },
}));

// Mock config
vi.mock('@/config', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  },
}));

// Import after mocks
import { MessageQueue, getMessageQueue, QueueName, MessagePersistenceJob } from '@/services/queue/MessageQueue';

// ============================================
// Test Helpers
// ============================================

function createMessageJob(sessionId: string, overrides: Partial<MessagePersistenceJob> = {}): MessagePersistenceJob {
  return {
    sessionId,
    messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: 'assistant',
    messageType: 'text',
    content: 'Test message',
    ...overrides,
  };
}

// ============================================
// Test Suite
// ============================================

describe('MessageQueue Rate Limiting', () => {
  let messageQueue: MessageQueue;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedis.__resetStore();

    // Reset singleton for clean tests
    // @ts-expect-error - Accessing private static for testing
    MessageQueue.instance = null;

    messageQueue = getMessageQueue();
    // Wait for ready
    await messageQueue.waitForReady();
  });

  afterEach(async () => {
    await messageQueue.close();
  });

  // ============================================
  // Rate Limit Enforcement
  // ============================================
  describe('Rate Limit Enforcement', () => {
    it('should allow up to 100 jobs per session per hour', async () => {
      // Arrange
      const sessionId = 'session-allow-100';
      const jobs: MessagePersistenceJob[] = [];

      // Act - Add 100 jobs
      for (let i = 0; i < 100; i++) {
        const job = createMessageJob(sessionId, { messageId: `msg-${i}` });
        jobs.push(job);
        await messageQueue.addMessagePersistence(job);
      }

      // Assert
      expect(mockQueue.add).toHaveBeenCalledTimes(100);

      const status = await messageQueue.getRateLimitStatus(sessionId);
      expect(status.count).toBe(100);
      expect(status.remaining).toBe(0);
      expect(status.withinLimit).toBe(true);
    });

    it('should reject job 101 with rate limit error', async () => {
      // Arrange
      const sessionId = 'session-reject-101';

      // Add 100 jobs first
      for (let i = 0; i < 100; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Act & Assert - Job 101 should throw
      const job101 = createMessageJob(sessionId, { messageId: 'msg-101' });
      await expect(messageQueue.addMessagePersistence(job101)).rejects.toThrow(
        /Rate limit exceeded for session/
      );

      // Verify error message contains session ID and limit
      try {
        await messageQueue.addMessagePersistence(job101);
      } catch (error) {
        expect((error as Error).message).toContain(sessionId);
        expect((error as Error).message).toContain('100');
      }
    });

    it('should track rate limits per session independently', async () => {
      // Arrange
      const sessionA = 'session-a';
      const sessionB = 'session-b';

      // Add 50 jobs to session A
      for (let i = 0; i < 50; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionA, { messageId: `a-${i}` })
        );
      }

      // Add 30 jobs to session B
      for (let i = 0; i < 30; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionB, { messageId: `b-${i}` })
        );
      }

      // Assert - each session has independent count
      const statusA = await messageQueue.getRateLimitStatus(sessionA);
      const statusB = await messageQueue.getRateLimitStatus(sessionB);

      expect(statusA.count).toBe(50);
      expect(statusA.remaining).toBe(50);

      expect(statusB.count).toBe(30);
      expect(statusB.remaining).toBe(70);
    });

    it('should not affect other sessions when one is rate limited', async () => {
      // Arrange
      const limitedSession = 'session-limited';
      const normalSession = 'session-normal';

      // Max out the limited session
      for (let i = 0; i < 100; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(limitedSession, { messageId: `limited-${i}` })
        );
      }

      // Act - Normal session should still work
      const normalJob = createMessageJob(normalSession, { messageId: 'normal-1' });
      await messageQueue.addMessagePersistence(normalJob);

      // Assert
      const normalStatus = await messageQueue.getRateLimitStatus(normalSession);
      expect(normalStatus.count).toBe(1);
      expect(normalStatus.remaining).toBe(99);
    });

    it('should return remaining quota in rate limit status', async () => {
      // Arrange
      const sessionId = 'session-quota';

      // Add 75 jobs
      for (let i = 0; i < 75; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Act
      const status = await messageQueue.getRateLimitStatus(sessionId);

      // Assert
      expect(status).toEqual({
        count: 75,
        limit: 100,
        remaining: 25,
        withinLimit: true,
      });
    });

    it('should log rate limit violations', async () => {
      // Arrange
      const sessionId = 'session-log-violation';

      // Max out the session
      for (let i = 0; i < 100; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Act - Try to add one more
      try {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: 'msg-101' })
        );
      } catch {
        // Expected to throw
      }

      // Assert - logger.warn should have been called
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded for session',
        expect.objectContaining({
          sessionId,
          limit: 100,
        })
      );
    });
  });

  // ============================================
  // Redis Failure Handling
  // ============================================
  describe('Redis Failure Handling', () => {
    it('should fail open when Redis incr fails (allow request)', async () => {
      // Arrange
      const sessionId = 'session-redis-fail';
      mockRedis.incr.mockRejectedValueOnce(new Error('Redis connection failed'));

      // Act - Should not throw, fail open
      const job = createMessageJob(sessionId);
      await messageQueue.addMessagePersistence(job);

      // Assert - Job was added despite Redis failure
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should log Redis connection failure', async () => {
      // Arrange
      const sessionId = 'session-log-redis';
      const redisError = new Error('ECONNREFUSED');
      mockRedis.incr.mockRejectedValueOnce(redisError);

      // Act
      await messageQueue.addMessagePersistence(createMessageJob(sessionId));

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to check rate limit',
        expect.objectContaining({
          sessionId,
        })
      );
    });

    it('should not crash on Redis timeout', async () => {
      // Arrange
      const sessionId = 'session-timeout';

      // Simulate timeout by making incr hang then reject
      mockRedis.incr.mockImplementationOnce(async () => {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ETIMEDOUT')), 10)
        );
        return 1;
      });

      // Act - Should not crash
      const job = createMessageJob(sessionId);
      await expect(messageQueue.addMessagePersistence(job)).resolves.toBeDefined();
    });

    it('should return default status when Redis get fails', async () => {
      // Arrange
      const sessionId = 'session-status-fail';
      mockRedis.get.mockRejectedValueOnce(new Error('Redis unavailable'));

      // Act
      const status = await messageQueue.getRateLimitStatus(sessionId);

      // Assert - Returns defaults
      expect(status).toEqual({
        count: 0,
        limit: 100,
        remaining: 100,
        withinLimit: true,
      });
    });
  });

  // ============================================
  // Counter Management
  // ============================================
  describe('Counter Management', () => {
    it('should set TTL only on first increment', async () => {
      // Arrange
      const sessionId = 'session-ttl';

      // Act - Add 3 jobs
      for (let i = 0; i < 3; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Assert - expire should be called only once (on first increment)
      expect(mockRedis.expire).toHaveBeenCalledTimes(1);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        `queue:ratelimit:${sessionId}`,
        3600 // 1 hour
      );
    });

    it('should use correct Redis key format', async () => {
      // Arrange
      const sessionId = 'my-unique-session-123';

      // Act
      await messageQueue.addMessagePersistence(createMessageJob(sessionId));

      // Assert
      expect(mockRedis.incr).toHaveBeenCalledWith(`queue:ratelimit:${sessionId}`);
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle sessionId with special characters', async () => {
      // Arrange - Session ID with various special chars
      const sessionId = 'session:with/special-chars_123';

      // Act
      await messageQueue.addMessagePersistence(createMessageJob(sessionId));

      // Assert
      expect(mockRedis.incr).toHaveBeenCalledWith(`queue:ratelimit:${sessionId}`);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should handle empty sessionId gracefully', async () => {
      // Arrange
      const sessionId = '';

      // Act
      await messageQueue.addMessagePersistence(createMessageJob(sessionId));

      // Assert - Should still work (rate limit is per-session, empty is valid)
      expect(mockRedis.incr).toHaveBeenCalledWith('queue:ratelimit:');
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should handle very long sessionId', async () => {
      // Arrange
      const sessionId = 'a'.repeat(1000);

      // Act
      await messageQueue.addMessagePersistence(createMessageJob(sessionId));

      // Assert
      expect(mockRedis.incr).toHaveBeenCalledWith(`queue:ratelimit:${sessionId}`);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should handle concurrent rate limit checks', async () => {
      // Arrange
      const sessionId = 'session-concurrent';

      // Act - Add 10 jobs concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `concurrent-${i}` })
        )
      );

      await Promise.all(promises);

      // Assert - All should succeed and count should be 10
      expect(mockQueue.add).toHaveBeenCalledTimes(10);
      const status = await messageQueue.getRateLimitStatus(sessionId);
      expect(status.count).toBe(10);
    });

    it('should handle rate limit at exact boundary (count = 100)', async () => {
      // Arrange
      const sessionId = 'session-boundary';

      // Add exactly 100 jobs
      for (let i = 0; i < 100; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Assert - Status shows exactly at limit
      const status = await messageQueue.getRateLimitStatus(sessionId);
      expect(status.count).toBe(100);
      expect(status.remaining).toBe(0);
      expect(status.withinLimit).toBe(true); // 100 is still within limit (<=)
    });

    it('should handle rate limit just over boundary (count = 101)', async () => {
      // Arrange
      const sessionId = 'session-over-boundary';

      // This simulates counter already being at 100
      for (let i = 0; i < 100; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Try to add 101st
      await expect(
        messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: 'msg-100' })
        )
      ).rejects.toThrow();

      // Status check still works
      const status = await messageQueue.getRateLimitStatus(sessionId);
      expect(status.count).toBe(101); // Counter was incremented even though job was rejected
      expect(status.withinLimit).toBe(false);
    });
  });

  // ============================================
  // Rate Limit Status API
  // ============================================
  describe('Rate Limit Status API', () => {
    it('should return correct status for new session', async () => {
      // Arrange - Fresh session with no jobs
      const sessionId = 'session-new';

      // Act
      const status = await messageQueue.getRateLimitStatus(sessionId);

      // Assert
      expect(status).toEqual({
        count: 0,
        limit: 100,
        remaining: 100,
        withinLimit: true,
      });
    });

    it('should return correct status for partially used session', async () => {
      // Arrange
      const sessionId = 'session-partial';

      // Add 42 jobs
      for (let i = 0; i < 42; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Act
      const status = await messageQueue.getRateLimitStatus(sessionId);

      // Assert
      expect(status).toEqual({
        count: 42,
        limit: 100,
        remaining: 58,
        withinLimit: true,
      });
    });

    it('should return correct status for rate-limited session', async () => {
      // Arrange - Max out session plus one more attempt
      const sessionId = 'session-maxed';

      for (let i = 0; i < 100; i++) {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: `msg-${i}` })
        );
      }

      // Try to exceed (will fail)
      try {
        await messageQueue.addMessagePersistence(
          createMessageJob(sessionId, { messageId: 'msg-over' })
        );
      } catch {
        // Expected
      }

      // Act
      const status = await messageQueue.getRateLimitStatus(sessionId);

      // Assert
      expect(status.count).toBeGreaterThan(100);
      expect(status.remaining).toBe(0);
      expect(status.withinLimit).toBe(false);
    });
  });
});
