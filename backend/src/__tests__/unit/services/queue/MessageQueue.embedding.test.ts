/**
 * UNIT TEST - MessageQueue Embedding Generation
 *
 * Tests the embedding generation queue integration in MessageQueue.
 *
 * @module __tests__/unit/services/queue/MessageQueue.embedding
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueName } from '@/services/queue/MessageQueue';

// ============================================
// Mock Dependencies using vi.hoisted
// ============================================

const {
  mockRedis,
  mockQueue,
  mockWorker,
  mockQueueEvents,
  mockLogger,
  mockExecuteQuery,
  mockEventStore,
} = vi.hoisted(() => {
  return {
    mockRedis: {
      on: vi.fn(),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === 'ready') setTimeout(callback, 0);
      }),
      options: {},
      quit: vi.fn(),
    },
    mockQueue: {
      add: vi.fn(async () => ({ id: 'job-123' })),
      close: vi.fn(),
      getWaitingCount: vi.fn(async () => 0),
      getActiveCount: vi.fn(async () => 0),
      getCompletedCount: vi.fn(async () => 0),
      getFailedCount: vi.fn(async () => 0),
      getDelayedCount: vi.fn(async () => 0),
    },
    mockWorker: {
      close: vi.fn(),
    },
    mockQueueEvents: {
      on: vi.fn(),
      close: vi.fn(),
    },
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockExecuteQuery: vi.fn(async () => ({ recordset: [] })),
    mockEventStore: {
      markAsProcessed: vi.fn(),
    },
  };
});

// Mock dependencies
vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis),
  Redis: vi.fn(() => mockRedis),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn((name, options) => {
      // We can inspect name here if needed, but for now return generic mock
      return mockQueue;
  }),
  Worker: vi.fn(() => mockWorker),
  QueueEvents: vi.fn(() => mockQueueEvents),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Import MessageQueue AFTER mocks
import { MessageQueue, __resetMessageQueue, EmbeddingGenerationJob } from '@/services/queue/MessageQueue';

describe('MessageQueue - Embedding Generation', () => {
  beforeEach(async () => {
    await __resetMessageQueue();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await __resetMessageQueue();
  });

  it('should initialize EMBEDDING_GENERATION queue', async () => {
    const mq = MessageQueue.getInstance({
      redis: mockRedis as any,
      executeQuery: mockExecuteQuery,
      logger: mockLogger,
    } as any);

    await mq.waitForReady();
    
    // Check internal queues map via verifying logs or indirect method
    // Since we mocked Queue constructor, we can check if it was called with EMBEDDING_GENERATION
    const { Queue } = await import('bullmq');
    expect(Queue).toHaveBeenCalledWith(QueueName.EMBEDDING_GENERATION, expect.any(Object));
  });

  it('should add embedding generation job to queue', async () => {
    const mq = MessageQueue.getInstance({
      redis: mockRedis as any,
      executeQuery: mockExecuteQuery,
      logger: mockLogger,
    } as any);

    await mq.waitForReady();

    const jobData: EmbeddingGenerationJob = {
      fileId: 'file-123',
      userId: 'user-456',
      chunks: [
          { id: 'c1', text: 'hello', chunkIndex: 0, tokenCount: 10 }
      ]
    };

    const jobId = await mq.addEmbeddingGenerationJob(jobData);

    expect(jobId).toBe('job-123');
    expect(mockQueue.add).toHaveBeenCalledWith('generate-embeddings', jobData, expect.objectContaining({
        priority: 2
    }));
  });
});
