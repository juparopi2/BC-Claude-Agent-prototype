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
import { MessageQueue, QueueName, EmbeddingGenerationJob, __resetMessageQueue, getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { executeQuery, initDatabase, getDatabase } from '@/infrastructure/database/database';
import { getEventStore } from '@/services/events/EventStore';
import { initRedisClient, closeRedisClient } from '@/infrastructure/redis/redis-client';
import { logger } from '@/shared/utils/logger';
import type { IEmbeddingServiceMinimal, IVectorSearchServiceMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

// ONLY mock logger (acceptable per audit)
vi.mock('@/shared/utils/logger', () => ({
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

// Note: External services are now injected via DI instead of vi.mock
// This avoids issues with dynamic imports in workers not picking up mocks

describe('Embedding Generation Pipeline', () => {
  setupDatabaseForTests();

  let messageQueue: MessageQueue;
  let queueEvents: QueueEvents;
  let factory: any;
  let testUser: any;
  let cleanupRedis: IORedis;
  let injectedRedis: IORedis | undefined;  // Track injected Redis for proper cleanup

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

  // Mock services stored at describe level for assertions
  let mockEmbeddingService: IEmbeddingServiceMinimal & { generateTextEmbeddingsBatch: ReturnType<typeof vi.fn> };
  let mockVectorSearchService: IVectorSearchServiceMinimal & { indexChunksBatch: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Use TestSessionFactory to create required data
    factory = createTestSessionFactory();
    testUser = await factory.createTestUser(); // Use random email

    // Reset singleton
    await __resetMessageQueue();
    await clearRedisKeys(cleanupRedis, 'bull:*');

    // Create mock services with vi.fn() for assertions
    mockEmbeddingService = {
        generateTextEmbeddingsBatch: vi.fn().mockResolvedValue([
            { embedding: [0.1, 0.2, 0.3], model: 'text-embedding-3-small' }, // Chunk 1
            { embedding: [0.4, 0.5, 0.6], model: 'text-embedding-3-small' }  // Chunk 2
        ])
    };

    mockVectorSearchService = {
        indexChunksBatch: vi.fn().mockImplementation(async (chunks: unknown[]) => {
            return chunks.map(() => factory.generateTestId());
        })
    };

    // Create a wrapped executeQuery that ensures DB connection before each call
    // This handles the case where the pool might be closed by another test's afterAll
    const ensureConnectedExecuteQuery: typeof executeQuery = async (query, params) => {
        const db = getDatabase();
        if (!db || !db.connected) {
            console.log('[pipeline.test] Re-initializing database connection...');
            await initDatabase();
        }
        return executeQuery(query, params);
    };

    // Initialize MessageQueue with real Redis, DB, and INJECTED mock services
    // This ensures the worker uses our mocks instead of dynamic imports
    // IMPORTANT: Store injectedRedis to close it properly in afterEach
    injectedRedis = new IORedis({ ...REDIS_TEST_CONFIG, maxRetriesPerRequest: null });
    messageQueue = getMessageQueue({
        redis: injectedRedis,
        executeQuery: ensureConnectedExecuteQuery,
        eventStore: getEventStore(),
        logger,
        embeddingService: mockEmbeddingService,
        vectorSearchService: mockVectorSearchService,
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
    // 1. Close MessageQueue first (doesn't close injected Redis)
    if (messageQueue) {
      await messageQueue.close();
    }

    // 2. Close QueueEvents
    if (queueEvents) {
      await queueEvents.close();
    }

    // 3. Wait for BullMQ internal connections to fully close
    await new Promise(resolve => setTimeout(resolve, 300));

    // 4. Close injected Redis explicitly (CRITICAL - prevents connection leak)
    if (injectedRedis) {
      await injectedRedis.quit();
      injectedRedis = undefined;
    }

    // 5. Cleanup test data
    if (factory) {
      await factory.cleanup();
    }
  });

  // FIX: Test now creates required DB records and uses correct mock format
  it('should process embedding generation job successfully', async () => {
    // 1. Create test data - Generate IDs
    const fileId = factory.generateTestId();
    const chunk1Id = factory.generateTestId();
    const chunk2Id = factory.generateTestId();

    // 2. Create file record in database (required for worker's UPDATE statement)
    await executeQuery(
      `INSERT INTO files (id, user_id, name, blob_path, mime_type, size_bytes, processing_status, embedding_status, created_at, updated_at)
       VALUES (@fileId, @userId, @name, @blobPath, @mimeType, @sizeBytes, @processingStatus, @embeddingStatus, GETDATE(), GETDATE())`,
      {
        fileId,
        userId: testUser.id,
        name: 'test-file.txt',
        blobPath: `users/${testUser.id}/files/${fileId}/test-file.txt`,
        mimeType: 'text/plain',
        sizeBytes: 100,
        processingStatus: 'completed',
        embeddingStatus: 'pending',
      }
    );

    // 3. Create file_chunks records in database (required for worker's UPDATE statement)
    await executeQuery(
      `INSERT INTO file_chunks (id, file_id, user_id, chunk_index, chunk_text, chunk_tokens, created_at)
       VALUES (@chunkId, @fileId, @userId, @chunkIndex, @chunkText, @chunkTokens, GETDATE())`,
      {
        chunkId: chunk1Id,
        fileId,
        userId: testUser.id,
        chunkIndex: 0,
        chunkText: 'Hello world',
        chunkTokens: 2,
      }
    );
    await executeQuery(
      `INSERT INTO file_chunks (id, file_id, user_id, chunk_index, chunk_text, chunk_tokens, created_at)
       VALUES (@chunkId, @fileId, @userId, @chunkIndex, @chunkText, @chunkTokens, GETDATE())`,
      {
        chunkId: chunk2Id,
        fileId,
        userId: testUser.id,
        chunkIndex: 1,
        chunkText: 'Another chunk',
        chunkTokens: 2,
      }
    );

    // 4. Create job data
    const jobData: EmbeddingGenerationJob = {
        fileId,
        userId: testUser.id,
        chunks: [
            { id: chunk1Id, text: 'Hello world', chunkIndex: 0, tokenCount: 2 },
            { id: chunk2Id, text: 'Another chunk', chunkIndex: 1, tokenCount: 2 }
        ]
    };

    // 5. Add job
    const jobId = await messageQueue.addEmbeddingGenerationJob(jobData);
    expect(jobId).toBeDefined();

    // 6. Wait for completion
    const completedPromise = new Promise<{jobId: string}>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Job timeout')), 15000);
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

    // 7. Verify injected mocks were called
    expect(mockEmbeddingService.generateTextEmbeddingsBatch).toHaveBeenCalledWith(
        ['Hello world', 'Another chunk'],
        testUser.id
    );

    expect(mockVectorSearchService.indexChunksBatch).toHaveBeenCalled();

    // 8. Verify database was updated
    const fileResult = await executeQuery<{ embedding_status: string }>(
      'SELECT embedding_status FROM files WHERE id = @fileId',
      { fileId }
    );
    expect(fileResult.recordset[0]?.embedding_status).toBe('completed');

    // 9. Cleanup test data (in case factory cleanup doesn't cover it)
    await executeQuery('DELETE FROM file_chunks WHERE file_id = @fileId', { fileId });
    await executeQuery('DELETE FROM files WHERE id = @fileId', { fileId });
  });
});
