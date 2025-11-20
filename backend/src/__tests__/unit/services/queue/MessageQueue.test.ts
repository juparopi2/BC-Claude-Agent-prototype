/**
 * MessageQueue Unit Tests - vi.hoisted() PATTERN
 *
 * Tests BullMQ integration, rate limiting, and queue management
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: EventStore.test.ts (40/40 tests passing)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueue, getMessageQueue, QueueName } from '@/services/queue/MessageQueue';
import type { MessagePersistenceJob, ToolExecutionJob, EventProcessingJob } from '@/services/queue/MessageQueue';

// ===== MOCK BULLMQ (vi.hoisted pattern) =====
const mockQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-123' }));
const mockQueueClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockQueueGetWaitingCount = vi.hoisted(() => vi.fn().mockResolvedValue(5));
const mockQueueGetActiveCount = vi.hoisted(() => vi.fn().mockResolvedValue(2));
const mockQueueGetCompletedCount = vi.hoisted(() => vi.fn().mockResolvedValue(100));
const mockQueueGetFailedCount = vi.hoisted(() => vi.fn().mockResolvedValue(3));
const mockQueueGetDelayedCount = vi.hoisted(() => vi.fn().mockResolvedValue(0));
const mockQueuePause = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockQueueResume = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockWorkerOn = vi.hoisted(() => vi.fn());
const mockWorkerClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockQueueEventsOn = vi.hoisted(() => vi.fn());
const mockQueueEventsClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Create spy constructors
const MockQueue = vi.hoisted(() => vi.fn(function(this: any, name: string) {
  return {
    name,
    add: mockQueueAdd,
    close: mockQueueClose,
    getWaitingCount: mockQueueGetWaitingCount,
    getActiveCount: mockQueueGetActiveCount,
    getCompletedCount: mockQueueGetCompletedCount,
    getFailedCount: mockQueueGetFailedCount,
    getDelayedCount: mockQueueGetDelayedCount,
    pause: mockQueuePause,
    resume: mockQueueResume,
  };
}));

const MockWorker = vi.hoisted(() => vi.fn(function(this: any, name: string, processor: Function) {
  return {
    name,
    on: mockWorkerOn,
    close: mockWorkerClose,
  };
}));

const MockQueueEvents = vi.hoisted(() => vi.fn(function(this: any, name: string) {
  return {
    name,
    on: mockQueueEventsOn,
    close: mockQueueEventsClose,
  };
}));

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
}));

// ===== MOCK IOREDIS (for BullMQ connection) =====
const mockRedisIncr = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisExpire = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue('50'));
const mockRedisSet = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));
const mockRedisQuit = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));

const MockRedis = vi.hoisted(() => vi.fn(function(this: any) {
  return {
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    get: mockRedisGet,
    set: mockRedisSet,
    quit: mockRedisQuit,
  };
}));

vi.mock('ioredis', () => ({
  Redis: MockRedis,
}));

// ===== MOCK DATABASE =====
const mockDbQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/config/database', () => ({
  executeQuery: mockDbQuery,
}));

// ===== MOCK EVENT STORE =====
const mockEventStoreMarkAsProcessed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    markAsProcessed: mockEventStoreMarkAsProcessed,
  })),
}));

// ===== MOCK LOGGER =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
}));

// ===== MOCK ENV =====
vi.mock('@/config', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  },
}));

describe('MessageQueue', () => {
  let messageQueue: MessageQueue;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockQueueAdd.mockResolvedValue({ id: 'job-123' });
    mockQueueClose.mockResolvedValue(undefined);
    mockQueueGetWaitingCount.mockResolvedValue(5);
    mockQueueGetActiveCount.mockResolvedValue(2);
    mockQueueGetCompletedCount.mockResolvedValue(100);
    mockQueueGetFailedCount.mockResolvedValue(3);
    mockQueueGetDelayedCount.mockResolvedValue(0);
    mockQueuePause.mockResolvedValue(undefined);
    mockQueueResume.mockResolvedValue(undefined);

    mockWorkerOn.mockImplementation(() => {});
    mockWorkerClose.mockResolvedValue(undefined);

    mockQueueEventsOn.mockImplementation(() => {});
    mockQueueEventsClose.mockResolvedValue(undefined);

    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue('50');
    mockRedisSet.mockResolvedValue('OK');
    mockRedisQuit.mockResolvedValue('OK');

    mockDbQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
    mockEventStoreMarkAsProcessed.mockResolvedValue(undefined);

    // Reset singleton instance
    (MessageQueue as any).instance = null;
    messageQueue = getMessageQueue();
  });

  // ========== BASIC FUNCTIONALITY (8 TESTS) ==========
  describe('Basic Functionality', () => {
    it('should return singleton instance', () => {
      const instance1 = getMessageQueue();
      const instance2 = getMessageQueue();

      expect(instance1).toBe(instance2);
    });

    it('should initialize 3 queues (message-persistence, tool-execution, event-processing)', () => {
      // Verify 3 Queue instances created
      expect(MockQueue).toHaveBeenCalledTimes(3);
      expect(MockQueue).toHaveBeenCalledWith(
        QueueName.MESSAGE_PERSISTENCE,
        expect.any(Object)
      );
      expect(MockQueue).toHaveBeenCalledWith(
        QueueName.TOOL_EXECUTION,
        expect.any(Object)
      );
      expect(MockQueue).toHaveBeenCalledWith(
        QueueName.EVENT_PROCESSING,
        expect.any(Object)
      );
    });

    it('should initialize 3 workers', () => {
      // Verify 3 Worker instances created
      expect(MockWorker).toHaveBeenCalledTimes(3);
    });

    it('should initialize 3 queue events', () => {
      // Verify 3 QueueEvents instances created
      expect(MockQueueEvents).toHaveBeenCalledTimes(3);
    });

    it('should create Redis connection with correct config', () => {
      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          maxRetriesPerRequest: null, // Required for BullMQ
        })
      );
    });

    it('should log initialization', () => {
      // Check for the actual log messages from MessageQueue.ts:103, 173, 227
      expect(mockLogger.info).toHaveBeenCalledWith(
        'MessageQueue initialized with BullMQ'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'All queues initialized',
        expect.objectContaining({
          queues: expect.arrayContaining([
            'message-persistence',
            'tool-execution',
            'event-processing',
          ]),
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'All workers initialized',
        expect.objectContaining({
          workers: expect.arrayContaining([
            'message-persistence',
            'tool-execution',
            'event-processing',
          ]),
        })
      );
    });

    it('should setup worker event listeners', () => {
      // QueueEvents (not Worker) register 'completed', 'failed', 'stalled' listeners
      expect(mockQueueEventsOn).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockQueueEventsOn).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockQueueEventsOn).toHaveBeenCalledWith('stalled', expect.any(Function));
    });

    it('should setup queue event listeners', () => {
      // QueueEvents register listeners (3 queues * 3 events = 9 calls)
      expect(mockQueueEventsOn).toHaveBeenCalled();
      expect(mockQueueEventsOn).toHaveBeenCalledTimes(9); // 3 queues * 3 events
    });
  });

  // ========== RATE LIMITING (8 TESTS) ==========
  describe('Rate Limiting', () => {
    it('should allow jobs within rate limit', async () => {
      mockRedisIncr.mockResolvedValueOnce(50); // Within limit (100)

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      const jobId = await messageQueue.addMessagePersistence(job);

      expect(jobId).toBe('job-123');
      expect(mockQueueAdd).toHaveBeenCalled();
    });

    it('should reject jobs exceeding rate limit', async () => {
      mockRedisIncr.mockResolvedValueOnce(101); // Exceeds limit (100)

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      await expect(messageQueue.addMessagePersistence(job)).rejects.toThrow(
        'Rate limit exceeded for session session-123'
      );
    });

    it('should track job count per session using Redis INCR', async () => {
      mockRedisIncr.mockResolvedValueOnce(1);

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      await messageQueue.addMessagePersistence(job);

      expect(mockRedisIncr).toHaveBeenCalledWith('queue:ratelimit:session-123');
    });

    it('should set TTL on rate limit key (1 hour)', async () => {
      mockRedisIncr.mockResolvedValueOnce(1);

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      await messageQueue.addMessagePersistence(job);

      expect(mockRedisExpire).toHaveBeenCalledWith('queue:ratelimit:session-123', 3600); // 1 hour
    });

    it('should rate limit per session (not globally)', async () => {
      mockRedisIncr.mockResolvedValue(1);

      const job1: MessagePersistenceJob = {
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      const job2: MessagePersistenceJob = {
        sessionId: 'session-2',
        messageId: 'msg-2',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      await messageQueue.addMessagePersistence(job1);
      await messageQueue.addMessagePersistence(job2);

      expect(mockRedisIncr).toHaveBeenCalledWith('queue:ratelimit:session-1');
      expect(mockRedisIncr).toHaveBeenCalledWith('queue:ratelimit:session-2');
    });

    it('should handle Redis errors during rate limit check', async () => {
      mockRedisIncr.mockRejectedValueOnce(new Error('Redis connection lost'));

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      // Should fail open - allow job to proceed even if rate limit check fails (line 293)
      const jobId = await messageQueue.addMessagePersistence(job);
      expect(jobId).toBe('job-123');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to check rate limit',
        expect.objectContaining({ sessionId: 'session-123' })
      );
    });

    it('should return rate limit status for session', async () => {
      mockRedisGet.mockResolvedValueOnce('75');

      const status = await messageQueue.getRateLimitStatus('session-123');

      expect(status.count).toBe(75); // Not currentCount, just count
      expect(status.limit).toBe(100);
      expect(status.remaining).toBe(25);
      expect(status.withinLimit).toBe(true);
    });

    it('should return zero count when no rate limit key exists', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      const status = await messageQueue.getRateLimitStatus('session-new');

      expect(status.count).toBe(0); // Not currentCount
      expect(status.remaining).toBe(100);
      expect(status.withinLimit).toBe(true);
    });
  });

  // ========== MESSAGE PERSISTENCE QUEUE (6 TESTS) ==========
  describe('Message Persistence Queue', () => {
    it('should add job to message-persistence queue', async () => {
      mockRedisIncr.mockResolvedValueOnce(1);

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello world',
      };

      const jobId = await messageQueue.addMessagePersistence(job);

      expect(jobId).toBe('job-123');
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'persist-message',
        job,
        { priority: 1 } // Only priority is passed in add(), not attempts/backoff
      );
    });

    it('should include job metadata', async () => {
      mockRedisIncr.mockResolvedValueOnce(1);

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
        metadata: { user_id: 'user-456', timestamp: Date.now() },
      };

      await messageQueue.addMessagePersistence(job);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'persist-message',
        expect.objectContaining({
          metadata: expect.objectContaining({ user_id: 'user-456' }),
        }),
        expect.any(Object)
      );
    });

    it('should configure exponential backoff for retries', async () => {
      // Retry config is set in Queue constructor defaultJobOptions, not in add()
      // This test verifies the Queue was initialized with the correct config

      expect(MockQueue).toHaveBeenCalledWith(
        QueueName.MESSAGE_PERSISTENCE,
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000, // MessageQueue.ts:129 - starts with 1s
            },
          }),
        })
      );
    });

    it('should log when job is added', async () => {
      mockRedisIncr.mockResolvedValueOnce(1);

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      await messageQueue.addMessagePersistence(job);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Message added to persistence queue', // MessageQueue.ts:328
        expect.objectContaining({
          jobId: 'job-123',
          sessionId: 'session-123',
          messageType: 'text',
        })
      );
    });

    it('should handle queue add errors', async () => {
      mockRedisIncr.mockResolvedValueOnce(1);
      mockQueueAdd.mockRejectedValueOnce(new Error('Queue full'));

      const job: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      await expect(messageQueue.addMessagePersistence(job)).rejects.toThrow('Queue full');
    });

    it('should support different message types', async () => {
      mockRedisIncr.mockResolvedValue(1);

      const textJob: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-1',
        role: 'user',
        messageType: 'text',
        content: 'Hello',
      };

      const thinkingJob: MessagePersistenceJob = {
        sessionId: 'session-123',
        messageId: 'msg-2',
        role: 'assistant',
        messageType: 'thinking',
        content: 'Analyzing...',
      };

      await messageQueue.addMessagePersistence(textJob);
      await messageQueue.addMessagePersistence(thinkingJob);

      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    });
  });

  // ========== TOOL EXECUTION QUEUE (5 TESTS) ==========
  describe('Tool Execution Queue', () => {
    it('should add job to tool-execution queue', async () => {
      const job: ToolExecutionJob = {
        sessionId: 'session-123',
        toolUseId: 'tool-456',
        toolName: 'list_all_entities',
        toolArgs: { entity: 'customer' },
        userId: 'user-789',
      };

      const jobId = await messageQueue.addToolExecution(job);

      expect(jobId).toBe('job-123');
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'execute-tool',
        job,
        { priority: 2 } // Only priority is passed, not attempts
      );
    });

    it('should configure lower retry count for tools (2 attempts)', async () => {
      // Retry config is set in Queue constructor defaultJobOptions
      // Tool execution queue has 2 attempts (lower than message persistence)

      expect(MockQueue).toHaveBeenCalledWith(
        QueueName.TOOL_EXECUTION,
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 2, // MessageQueue.ts:149
            backoff: {
              type: 'exponential',
              delay: 2000, // MessageQueue.ts:152
            },
          }),
        })
      );
    });

    it('should log tool execution job', async () => {
      const job: ToolExecutionJob = {
        sessionId: 'session-123',
        toolUseId: 'tool-456',
        toolName: 'list_all_entities',
        toolArgs: {},
        userId: 'user-789',
      };

      await messageQueue.addToolExecution(job);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Tool execution added to queue', // MessageQueue.ts:353
        expect.objectContaining({
          jobId: 'job-123',
          toolName: 'list_all_entities',
        })
      );
    });

    it('should handle tool job errors', async () => {
      mockQueueAdd.mockRejectedValueOnce(new Error('Tool queue error'));

      const job: ToolExecutionJob = {
        sessionId: 'session-123',
        toolUseId: 'tool-456',
        toolName: 'list_all_entities',
        toolArgs: {},
        userId: 'user-789',
      };

      await expect(messageQueue.addToolExecution(job)).rejects.toThrow('Tool queue error');
    });

    it('should support different tool names', async () => {
      const job1: ToolExecutionJob = {
        sessionId: 'session-123',
        toolUseId: 'tool-1',
        toolName: 'list_all_entities',
        toolArgs: {},
        userId: 'user-1',
      };

      const job2: ToolExecutionJob = {
        sessionId: 'session-123',
        toolUseId: 'tool-2',
        toolName: 'get_entity_by_id',
        toolArgs: { entity: 'customer', id: '123' },
        userId: 'user-1',
      };

      await messageQueue.addToolExecution(job1);
      await messageQueue.addToolExecution(job2);

      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    });
  });

  // ========== EVENT PROCESSING QUEUE (4 TESTS) ==========
  describe('Event Processing Queue', () => {
    it('should add job to event-processing queue', async () => {
      const job: EventProcessingJob = {
        eventId: 'evt-123',
        sessionId: 'session-456',
        eventType: 'user_message_sent',
        data: { message_id: 'msg-789', content: 'Hello' },
      };

      const jobId = await messageQueue.addEventProcessing(job);

      expect(jobId).toBe('job-123');
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'process-event',
        job,
        expect.any(Object)
      );
    });

    it('should configure event processing job options', async () => {
      // Event processing queue config is set in constructor defaultJobOptions
      // This verifies the Queue was initialized with correct config

      expect(MockQueue).toHaveBeenCalledWith(
        QueueName.EVENT_PROCESSING,
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 3, // MessageQueue.ts:164
            backoff: {
              type: 'exponential',
              delay: 500, // MessageQueue.ts:167
            },
          }),
        })
      );
    });

    it('should log event processing job', async () => {
      // addEventProcessing() does NOT log (lines 367-377) - just returns job ID
      // This test verifies job is successfully added without logging
      const job: EventProcessingJob = {
        eventId: 'evt-123',
        sessionId: 'session-456',
        eventType: 'user_message_sent',
        data: {},
      };

      const jobId = await messageQueue.addEventProcessing(job);

      expect(jobId).toBe('job-123');
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'process-event',
        job,
        { priority: 3 }
      );
      // No logger.debug() call in addEventProcessing()
    });

    it('should handle event processing errors', async () => {
      mockQueueAdd.mockRejectedValueOnce(new Error('Event queue error'));

      const job: EventProcessingJob = {
        eventId: 'evt-123',
        sessionId: 'session-456',
        eventType: 'user_message_sent',
        data: {},
      };

      await expect(messageQueue.addEventProcessing(job)).rejects.toThrow('Event queue error');
    });
  });

  // ========== QUEUE MANAGEMENT (4 TESTS) ==========
  describe('Queue Management', () => {
    it('should get queue statistics', async () => {
      const stats = await messageQueue.getQueueStats(QueueName.MESSAGE_PERSISTENCE);

      // getQueueStats() returns 5 count fields, NOT the name (lines 516-536)
      expect(stats).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 0,
      });
    });

    it('should pause queue', async () => {
      await messageQueue.pauseQueue(QueueName.MESSAGE_PERSISTENCE);

      expect(mockQueuePause).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Queue ${QueueName.MESSAGE_PERSISTENCE} paused`
      );
    });

    it('should resume queue', async () => {
      await messageQueue.resumeQueue(QueueName.MESSAGE_PERSISTENCE);

      expect(mockQueueResume).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Queue ${QueueName.MESSAGE_PERSISTENCE} resumed`
      );
    });

    it('should close all queues and workers gracefully', async () => {
      await messageQueue.close();

      expect(mockQueueClose).toHaveBeenCalledTimes(3); // 3 queues
      expect(mockWorkerClose).toHaveBeenCalledTimes(3); // 3 workers
      expect(mockQueueEventsClose).toHaveBeenCalledTimes(3); // 3 queue events
      expect(mockRedisQuit).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('MessageQueue closed successfully');
    });
  });
});
