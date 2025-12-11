/**
 * Embedding Generation Pipeline Integration Tests
 *
 * Tests the end-to-end flow of embedding generation via MessageQueue.
 * Uses real Redis and DB, but mocks external AI services (EmbeddingService, VectorSearchService).
 *
 * @module __tests__/integration/embeddings/pipeline.integration.test
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import IORedis from 'ioredis';
import { QueueEvents } from 'bullmq';
import { REDIS_TEST_CONFIG, clearRedisKeys, createTestRedisConnection } from '../../setup.integration';
import { setupDatabaseForTests, createTestSessionFactory } from '../../helpers';
import { MessageQueue, QueueName, EmbeddingGenerationJob, __resetMessageQueue, getMessageQueue } from '@/services/queue/MessageQueue';
import { executeQuery } from '@/config/database';
import { getEventStore } from '@/services/events/EventStore';
import { initRedisClient, closeRedisClient } from '@/config/redis-client';
import fs from 'fs';
import { logger } from '@/utils/logger';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';

// ONLY mock logger (acceptable per audit)
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn((msg, meta) => console.log('[INFO]', msg, meta || '')),
    error: vi.fn((msg, meta) => console.error('[ERROR]', msg, meta || '')),
    warn: vi.fn((msg, meta) => console.warn('[WARN]', msg, meta || '')),
    debug: vi.fn((msg, meta) => console.debug('[DEBUG]', msg, meta || '')),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn((msg, meta) => console.log('[INFO]', msg, meta || '')),
    error: vi.fn((msg, meta) => console.error('[ERROR]', msg, meta || '')),
    warn: vi.fn((msg, meta) => console.warn('[WARN]', msg, meta || '')),
    debug: vi.fn((msg, meta) => console.debug('[DEBUG]', msg, meta || '')),
    trace: vi.fn(),
    fatal: vi.fn((msg, meta) => console.error('[FATAL]', msg, meta || '')),
    child: vi.fn(),
  })),
}));

// Mock external services to avoid API costs and network dependencies
vi.mock('@/services/embeddings/EmbeddingService', () => ({
  EmbeddingService: {
    getInstance: vi.fn(() => ({
      generateTextEmbeddingsBatch: vi.fn(),
    })),
  },
}));

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      indexChunksBatch: vi.fn(),
    })),
  },
}));

describe('Embedding Generation Pipeline', () => {
  setupDatabaseForTests();

  let messageQueue: MessageQueue;
  let queueEvents: QueueEvents;
  let factory: any;
  let testUser: any;
  let cleanupRedis: IORedis;

  beforeAll(async () => {
    // Ensure redis client initialized for SessionFactory (node-redis)
    await initRedisClient();
    cleanupRedis = createTestRedisConnection();
    // Verify connection
    await cleanupRedis.ping();
  });

  afterAll(async () => {
    await closeRedisClient();
    if (cleanupRedis) {
        await cleanupRedis.quit();
    }
  });

  beforeEach(async () => {
    // Use TestSessionFactory to create required data
    factory = createTestSessionFactory();
    testUser = await factory.createTestUser(); // Use random email

    // Reset singleton
    await __resetMessageQueue();
    await clearRedisKeys(cleanupRedis, 'bull:*');

    // Mock Embedding Service behavior
    const mockEmbeddingService = {
        generateTextEmbeddingsBatch: vi.fn().mockResolvedValue([
            [0.1, 0.2, 0.3], // Chunk 1
            [0.4, 0.5, 0.6]  // Chunk 2
        ])
    };
    (EmbeddingService.getInstance as any).mockReturnValue(mockEmbeddingService);

    // Mock Vector Search behavior
    const mockVectorSearchService = {
        indexChunksBatch: vi.fn().mockImplementation(async (chunks: any[]) => {
            return chunks.map(() => factory.generateTestId());
        })
    };
    (VectorSearchService.getInstance as any).mockReturnValue(mockVectorSearchService);

    // Initialize MessageQueue with real Redis
    messageQueue = getMessageQueue({
        redis: new IORedis({ ...REDIS_TEST_CONFIG, maxRetriesPerRequest: null }),
        executeQuery,
        eventStore: getEventStore(),
        logger,
    });
    // Ensure MessageQueue connects
    await messageQueue.waitForReady();

    // Initialize QueueEvents for verification
    queueEvents = new QueueEvents(QueueName.EMBEDDING_GENERATION, {
        connection: REDIS_TEST_CONFIG
    });
    // Wait for QueueEvents to be ready to ensure we don't miss events
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    if (messageQueue) await messageQueue.close();
    if (queueEvents) await queueEvents.close();
    if (factory) await factory.cleanup();
  });

  it('should process embedding generation job successfully', async () => {
    // 1. Create a dummy file chunk job
    const fileId = factory.generateTestId();
    const chunk1Id = factory.generateTestId();
    const chunk2Id = factory.generateTestId();

    const jobData: EmbeddingGenerationJob = {
        fileId,
        userId: testUser.id,
        chunks: [
            { id: chunk1Id, text: 'Hello world', chunkIndex: 0, tokenCount: 2 },
            { id: chunk2Id, text: 'Another chunk', chunkIndex: 1, tokenCount: 2 }
        ]
    };

    // 2. Add job
    const jobId = await messageQueue.addEmbeddingGenerationJob(jobData);
    expect(jobId).toBeDefined();

    // 3. Wait for completion
    const completedPromise = new Promise<{jobId: string}>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Job timeout')), 10000);
        queueEvents.on('completed', ({ jobId: id }) => {
            console.log(`Job ${id} completed`);
            if (id === jobId) {
                clearTimeout(timeout);
                resolve({ jobId: id });
            }
        });
        queueEvents.on('failed', ({ jobId: id, failedReason }) => {
            console.error(`Job ${id} failed: ${failedReason}`);
            if (id === jobId) {
                clearTimeout(timeout);
                reject(new Error(`Job failed: ${failedReason}`));
            }
        });
    });

    await completedPromise;

    // 4. Verify mocks called
    const embeddingService = EmbeddingService.getInstance();
    expect(embeddingService.generateTextEmbeddingsBatch).toHaveBeenCalledWith(
        ['Hello world', 'Another chunk'], 
        testUser.id
    );

    const vectorSearchService = VectorSearchService.getInstance();
    expect(vectorSearchService.indexChunksBatch).toHaveBeenCalled();
  });
});
